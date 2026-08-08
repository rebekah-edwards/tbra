/**
 * merge-local-dupe-books.ts — merge local-only duplicate book rows onto their
 * live twin, then adopt the live row locally.
 *
 * WHY THIS EXISTS
 * ---------------
 * Local and live drifted into holding the same book under two different UUIDs.
 * Every night the same thing happens:
 *
 *   - sync-push tries to INSERT the local row → live already owns that
 *     isbn_13/slug → INSERT OR IGNORE drops all 549, and every junction row
 *     hanging off them fails FK. Nothing ever lands.
 *   - sync-pull tries to INSERT the live row → the LOCAL dupe already owns that
 *     isbn_13/slug → UNIQUE constraint. `books` has no NATURAL_KEYS entry, so
 *     the handler silently swallows it and the run still prints "in sync".
 *     579 live books have never reached local because of this.
 *   - The live twin's junction rows DO pull down, land as orphans (their
 *     book_id isn't local), and sync-push step 0 deletes them. ~4,030 rows
 *     churn every single night.
 *
 * Deleting the local dupes alone would throw away whatever enrichment and user
 * activity sits on them, so each pair is re-pointed first:
 *
 *   1. move every child row from the local dupe id onto the live canonical id
 *   2. delete the local dupe row (this frees the isbn_13 / slug)
 *   3. INSERT the live canonical row locally in the same transaction
 *
 * Step 3 is what keeps the window closed: between 2 and 3 the just-moved
 * children would be orphans, and sync-push's hygiene pre-pass deletes orphaned
 * junction rows. Doing all three atomically means that state is never visible.
 *
 * SAFETY
 * ------
 * Per-owner-unique tables (MOVE_UNIQUE) move with a plain UPDATE, never
 * `INSERT OR IGNORE` + `DELETE` — that form silently destroyed ratings and
 * reviews on 2026-07-30 (memory: project_dedup_move_destroyed_ratings). A pair
 * where the same user/shelf holds rows on BOTH books cannot move cleanly, so it
 * is HELD for manual merge and left completely untouched.
 *
 * Writes are LOCAL ONLY. Live already holds the canonical row; nothing about
 * this script deletes or rewrites anything on Turso.
 *
 * Usage:
 *   npx tsx scripts/merge-local-dupe-books.ts            # audit only (default)
 *   npx tsx scripts/merge-local-dupe-books.ts --apply
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import Database from 'better-sqlite3';
import { createGuardedTurso } from './lib/turso-guard';
import { MOVE_UNIQUE, localRunner, findUserOverlap } from './lib/dupe-overlap';

const APPLY = process.argv.includes('--apply');

/** Junction tables where a collision means "the canonical already has this
 *  author/genre/series" — the leftover row is pure redundancy, safe to drop. */
const REDUNDANT_ON_COLLISION = new Set([
  'book_authors',
  'book_genres',
  'book_series',
  'book_narrators',
]);

/** Leftover migration table from a Drizzle rename — not real data. */
const IGNORE_TABLES = new Set(['__new_user_book_ratings']);

type Pair = {
  dupeId: string;
  canonicalId: string;
  title: string;
  matchedOn: 'isbn_13' | 'open_library_key' | 'slug';
  canonicalLocal: boolean;
  /** table -> rows sitting on the local dupe */
  children: Record<string, number>;
  overlap: string[];
  hold?: string;
};

function bookIdTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT m.name FROM sqlite_master m
        WHERE m.type='table'
          AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) p WHERE p.name='book_id')
        ORDER BY m.name`,
    )
    .all() as any[];
  return rows.map((r) => String(r.name)).filter((t) => !IGNORE_TABLES.has(t));
}

async function main() {
  const { remote } = await createGuardedTurso({
    name: 'merge-local-dupe-books',
    maxRuntimeMs: 45 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  const db = new Database('data/tbra.db');
  const TABLES = bookIdTables(db);
  const localCols = db.prepare('PRAGMA table_info(books)').all() as any[];
  const bookCols = localCols.map((c) => String(c.name));

  console.log(`[merge] ${APPLY ? 'APPLY' : 'AUDIT (dry run)'} — ${TABLES.length} child tables\n`);

  // ── 1. live book id set ────────────────────────────────────────────────
  const liveIds = new Set<string>();
  let cursor = '';
  for (;;) {
    const r = await remote.execute({
      sql: 'SELECT id FROM books WHERE id > ? ORDER BY id LIMIT 5000',
      args: [cursor],
    });
    if (r.rows.length === 0) break;
    for (const row of r.rows) liveIds.add(String(row.id));
    cursor = String(r.rows[r.rows.length - 1].id);
  }

  const localBooks = db
    .prepare('SELECT id, title, isbn_13, open_library_key, slug FROM books')
    .all() as any[];
  const localIds = new Set(localBooks.map((b) => String(b.id)));
  const orphanLocal = localBooks.filter((b) => !liveIds.has(String(b.id)));
  console.log(`local ${localBooks.length} / live ${liveIds.size} — ${orphanLocal.length} local rows not on live\n`);

  // ── 2. pair each local-only row with its live twin ─────────────────────
  const pairs: Pair[] = [];
  const unpaired: any[] = [];
  const run = localRunner(db);

  for (const b of orphanLocal) {
    let canonicalId: string | null = null;
    let matchedOn: 'isbn_13' | 'open_library_key' | 'slug' = 'isbn_13';

    if (b.isbn_13) {
      const r = await remote.execute({
        sql: 'SELECT id FROM books WHERE isbn_13 = ? LIMIT 1',
        args: [b.isbn_13],
      });
      if (r.rows.length) canonicalId = String(r.rows[0].id);
    }
    // open_library_key is the OTHER unique index on books, so it blocks a live
    // insert exactly the same way isbn_13 does — matching only on isbn_13/slug
    // left 11 twins looking like genuinely local-only books.
    if (!canonicalId && b.open_library_key) {
      const r = await remote.execute({
        sql: 'SELECT id FROM books WHERE open_library_key = ? LIMIT 1',
        args: [b.open_library_key],
      });
      if (r.rows.length) { canonicalId = String(r.rows[0].id); matchedOn = 'open_library_key'; }
    }
    if (!canonicalId && b.slug) {
      const r = await remote.execute({
        sql: 'SELECT id FROM books WHERE slug = ? LIMIT 1',
        args: [b.slug],
      });
      if (r.rows.length) { canonicalId = String(r.rows[0].id); matchedOn = 'slug'; }
    }
    if (!canonicalId) { unpaired.push(b); continue; }

    const children: Record<string, number> = {};
    for (const t of TABLES) {
      const n = Number(
        (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`).get(b.id) as any).n,
      );
      if (n > 0) children[t] = n;
    }

    // Overlap only matters when BOTH rows exist locally — if the canonical
    // isn't local yet there is nothing on the other side to collide with.
    const canonicalLocal = localIds.has(canonicalId);
    const overlap = canonicalLocal ? await findUserOverlap(run, canonicalId, String(b.id)) : [];

    pairs.push({
      dupeId: String(b.id),
      canonicalId,
      title: String(b.title),
      matchedOn,
      canonicalLocal,
      children,
      overlap,
      hold: overlap.length ? `user rows on both books (${overlap.join(', ')})` : undefined,
    });
  }

  // ── 3. report ──────────────────────────────────────────────────────────
  const mergeable = pairs.filter((p) => !p.hold);
  const held = pairs.filter((p) => p.hold);

  const childTotals: Record<string, number> = {};
  for (const p of mergeable) {
    for (const [t, n] of Object.entries(p.children)) childTotals[t] = (childTotals[t] ?? 0) + n;
  }

  console.log(`pairs matched:      ${pairs.length}`);
  console.log(`  ready to merge:   ${mergeable.length}`);
  console.log(`  held (overlap):   ${held.length}`);
  console.log(`unpaired (no twin): ${unpaired.length}`);
  console.log(`canonical already local: ${pairs.filter((p) => p.canonicalLocal).length}\n`);

  console.log('child rows to move (mergeable pairs):');
  for (const [t, n] of Object.entries(childTotals).sort((a, b) => b[1] - a[1])) {
    const flag = MOVE_UNIQUE.includes(t) ? '  ← user data' : '';
    console.log(`  ${t.padEnd(28)} ${String(n).padStart(6)}${flag}`);
  }
  if (Object.keys(childTotals).length === 0) console.log('  (none)');

  if (held.length) {
    console.log('\nHELD for manual merge (untouched):');
    for (const p of held.slice(0, 20)) console.log(`  ${p.title} — ${p.hold}`);
    if (held.length > 20) console.log(`  … and ${held.length - 20} more`);
  }
  if (unpaired.length) {
    console.log('\nNo live twin (left alone, sync-push will keep retrying):');
    for (const b of unpaired.slice(0, 20)) console.log(`  ${b.title} (${b.id})`);
  }

  if (!APPLY) {
    console.log('\n[merge] dry run — nothing written. Re-run with --apply.');
    process.exit(0);
  }

  // ── 4. apply ───────────────────────────────────────────────────────────
  const liveRowStmt = `SELECT ${bookCols.join(',')} FROM books WHERE id = ?`;
  const insertBook = db.prepare(
    `INSERT INTO books (${bookCols.join(',')}) VALUES (${bookCols.map(() => '?').join(',')})`,
  );

  let merged = 0, adopted = 0, failed = 0, movedRows = 0, droppedRedundant = 0;

  for (const p of mergeable) {
    // Fetch the live canonical row up front — the transaction must not await.
    let liveRow: any = null;
    if (!p.canonicalLocal) {
      const r = await remote.execute({ sql: liveRowStmt, args: [p.canonicalId] });
      liveRow = r.rows[0] ?? null;
      if (!liveRow) { failed++; console.log(`  ✗ ${p.title}: canonical vanished from live`); continue; }
    }

    const trx = db.transaction(() => {
      // Order matters — every step below is valid under IMMEDIATE FK checking,
      // which is why this doesn't use `defer_foreign_keys`. Deferring looked
      // simpler but re-validating a moved row re-raises any pre-existing
      // dangling FK it already carried (a missing genre/category), and that
      // violation can never be resolved inside the transaction, so the commit
      // fails for a reason having nothing to do with the merge.
      //
      //   1. release the dupe's unique values (isbn_13, open_library_key are
      //      the only UNIQUE columns on books, and both are nullable)
      //   2. insert the canonical — now unblocked, so children have a valid
      //      parent to point at
      //   3. move the children
      //   4. drop the dupe, which by now has no referents
      db.prepare('UPDATE books SET isbn_13 = NULL, open_library_key = NULL WHERE id = ?')
        .run(p.dupeId);

      if (liveRow) insertBook.run(...bookCols.map((c) => liveRow[c]));

      for (const t of Object.keys(p.children)) {
        if (REDUNDANT_ON_COLLISION.has(t)) {
          const u = db.prepare(`UPDATE OR IGNORE ${t} SET book_id = ? WHERE book_id = ?`)
            .run(p.canonicalId, p.dupeId);
          movedRows += u.changes;
          const d = db.prepare(`DELETE FROM ${t} WHERE book_id = ?`).run(p.dupeId);
          droppedRedundant += d.changes;
        } else {
          // Plain UPDATE: throws on any constraint clash rather than dropping a
          // row. A throw aborts the whole pair — nothing half-merged.
          const u = db.prepare(`UPDATE ${t} SET book_id = ? WHERE book_id = ?`)
            .run(p.canonicalId, p.dupeId);
          movedRows += u.changes;
        }
      }

      db.prepare('DELETE FROM books WHERE id = ?').run(p.dupeId);
    });

    try { trx(); merged++; if (liveRow) adopted++; }
    catch (e: any) {
      failed++;
      console.log(`  ✗ ${p.title}: ${String(e.message).slice(0, 120)}`);
    }
  }

  console.log(`\n[merge] merged ${merged} pairs (${failed} failed)`);
  console.log(`        ${movedRows} child rows re-pointed, ${droppedRedundant} redundant junction rows dropped`);
  console.log(`        ${adopted} live canonical rows adopted into local`);
  console.log(`        ${held.length} pairs held for manual merge`);
  process.exit(0);
}

main();
