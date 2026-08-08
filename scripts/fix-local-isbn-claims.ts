/**
 * fix-local-isbn-claims.ts — free UNIQUE identifier values that a local row is
 * holding on behalf of a different live book.
 *
 * WHY THIS EXISTS
 * ---------------
 * sync-pull updates a local book row from its live twin by id. When live says
 * book B owns isbn_13 X, but a DIFFERENT local row L is still holding X, the
 * UPDATE trips `UNIQUE constraint failed: books.isbn_13` and B's metadata never
 * lands locally. That surfaced as 16 identical error lines on every single pull.
 *
 * Two ways a local row ends up squatting on someone else's identifier:
 *   - true near-duplicates ("Bad Luck Vampire" ×2, "For love of Hawk" /
 *     "For Love Of Hawk") where the pair never got deduped
 *   - genuinely wrong local data — an omnibus/collection row that grabbed a
 *     member book's ISBN ("Charles Portis : Collected Works" holding Gringos'
 *     ISBN, "Light Perpetual" holding Tower of Fools')
 *
 * Both resolve the same way, without having to tell them apart: live is
 * authoritative for a book's identity, so the local row adopts whatever live
 * says THAT SAME id owns. Because the column is UNIQUE on live too, live's value
 * for L is necessarily different from X — so adopting it always frees X. A local
 * row with no live twin gets the value cleared instead.
 *
 * Local writes only. isbn_13 / open_library_key are not in sync-push's metadata
 * update list, so nothing here can propagate back to live.
 *
 * Usage:
 *   npx tsx scripts/fix-local-isbn-claims.ts           # dry run
 *   npx tsx scripts/fix-local-isbn-claims.ts --apply
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import Database from 'better-sqlite3';
import { createGuardedTurso } from './lib/turso-guard';

const APPLY = process.argv.includes('--apply');

/** UNIQUE-indexed identifier columns on books, plus the same idea on editions. */
const TARGETS: Array<{ table: string; col: string }> = [
  { table: 'books', col: 'isbn_13' },
  { table: 'books', col: 'open_library_key' },
  { table: 'editions', col: 'open_library_key' },
];

async function main() {
  const { remote } = await createGuardedTurso({
    name: 'fix-local-isbn-claims',
    maxRuntimeMs: 30 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const db = new Database('data/tbra.db');

  console.log(`[isbn-claims] ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  let grandTotal = 0;

  for (const { table, col } of TARGETS) {
    let cols: string[];
    try {
      cols = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => String(c.name));
    } catch {
      console.log(`  · ${table}.${col} — table not in local DB, skipped`);
      continue;
    }
    if (!cols.includes(col)) { console.log(`  · ${table}.${col} — column absent, skipped`); continue; }

    // Local holders, keyed by the contested value.
    const holders = new Map<string, any>();
    for (const r of db.prepare(`SELECT id, title, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`).all() as any[]) {
      holders.set(String(r.v), r);
    }

    // Walk live and find values assigned to a DIFFERENT id than local's holder.
    const conflicts: Array<{ localId: string; localTitle: string; value: string; liveOwner: string }> = [];
    let cursor = '';
    for (;;) {
      const r = await remote.execute({
        sql: `SELECT id, ${col} AS v FROM ${table} WHERE id > ? AND ${col} IS NOT NULL ORDER BY id LIMIT 5000`,
        args: [cursor],
      });
      if (r.rows.length === 0) break;
      for (const row of r.rows as any[]) {
        const h = holders.get(String(row.v));
        if (h && String(h.id) !== String(row.id)) {
          conflicts.push({ localId: String(h.id), localTitle: String(h.title ?? ''), value: String(row.v), liveOwner: String(row.id) });
        }
      }
      cursor = String(r.rows[r.rows.length - 1].id);
    }

    if (conflicts.length === 0) { console.log(`  · ${table}.${col.padEnd(18)} clean`); continue; }

    // Resolve each: adopt live's value for the squatting row, else clear it.
    // A NOT NULL column can't be cleared — those are reported, not forced.
    const notNull = Boolean(
      (db.prepare(`PRAGMA table_info(${table})`).all() as any[])
        .find((c) => String(c.name) === col)?.notnull,
    );
    const update = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`);
    let adopted = 0, cleared = 0, unclearable = 0;

    for (const c of conflicts) {
      const live = await remote.execute({ sql: `SELECT ${col} AS v FROM ${table} WHERE id = ?`, args: [c.localId] });
      const correct = live.rows.length ? (live.rows[0] as any).v ?? null : null;

      // Paranoia: never write back a value that is itself contested.
      if (correct !== null && String(correct) === c.value) {
        console.log(`    ! ${c.localTitle}: live reports the same ${col}, skipping`);
        continue;
      }
      if (correct === null && notNull) {
        unclearable++;
        console.log(`    ! ${table}.${col} is NOT NULL and live has no value for ${c.localId.slice(0, 8)} — left in place`);
        continue;
      }
      if (APPLY) update.run(correct, c.localId);
      correct === null ? cleared++ : adopted++;
    }

    // "cleared" means live holds NULL for this id — either the row is absent
    // from live, or (the common case) live simply never assigned it one. Both
    // resolve to the same write, so they are not distinguished here.
    console.log(
      `  ${APPLY ? '✓' : '⚠'} ${table}.${col.padEnd(18)} ${conflicts.length} conflict(s) — ` +
        `${adopted} adopt live value, ${cleared} cleared to match live NULL` +
        (unclearable ? `, ${unclearable} left in place (NOT NULL)` : ''),
    );
    grandTotal += conflicts.length;
  }

  console.log(
    APPLY
      ? `\n[isbn-claims] done — ${grandTotal} contested identifier(s) released locally`
      : `\n[isbn-claims] dry run — ${grandTotal} contested identifier(s) found. Re-run with --apply.`,
  );
  process.exit(0);
}

main();
