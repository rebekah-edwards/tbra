/**
 * sync-push.ts — Push local SQLite changes to production Turso via @libsql/client.
 *
 * Replaces the Turso-CLI-based push in sync-incremental.sh, which is broken because the
 * local `turso` CLI is authed to `tbra-rebekah-edwards`, not the production DB
 * `tbra-web-app-thebasedreaderapp`. This script reads TURSO_DATABASE_URL and
 * TURSO_AUTH_TOKEN from .env.vercel.local and talks to Turso directly.
 *
 * What it pushes (INSERT OR IGNORE — never deletes, never overwrites):
 *   - new books (and their book_authors, book_genres, book_series, book_category_ratings, enrichment_log)
 *   - new authors / series / genres referenced by those books
 *   - new reported_issues rows created locally (e.g. nightly-junk-sweep flags) —
 *     INSERT OR IGNORE by id only, so live admin resolutions are never overwritten
 *   - landing_page_books and landing_page_copy (full replace — admin-managed)
 *
 * Does NOT push user-data tables (those are bidirectional; admin edits happen on live).
 * For content-ratings updates to EXISTING books, use push-content-ratings-to-turso.ts.
 */

require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── PID lockfile: prevent parallel sync-push runs ───
// Added after the 2026-04-20 incident where a stuck sync-push from a
// scheduled task ran silently for 2h 9m holding Turso connections — a manual
// sync-push started on top of it compounded the problem and degraded book-
// page loads to 40s+. Lockfile writes PID on start, refuses if another PID
// is live, clears on exit (normal, error, SIGINT, SIGTERM).
const LOCK_PATH = '/tmp/tbra-sync-push.lock';
(function acquireLock() {
  try {
    const existing = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    const pid = parseInt(existing, 10);
    if (pid && Number.isFinite(pid)) {
      try {
        process.kill(pid, 0); // signal 0 = check liveness only
        console.error(`ERROR: sync-push already running (PID ${pid}). Remove ${LOCK_PATH} to override.`);
        process.exit(2);
      } catch {
        console.log(`Stale lockfile (PID ${pid} no longer running). Taking over.`);
      }
    }
  } catch { /* no lockfile — fall through */ }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  const cleanup = () => { try { fs.unlinkSync(LOCK_PATH); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGINT',  () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (e: Error) => { console.error(e); cleanup(); process.exit(1); });
})();

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('ERROR: TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing from .env.vercel.local');
  console.error('Run: npx vercel env pull');
  process.exit(1);
}

const remote = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const local = new Database(path.join(process.cwd(), 'data', 'tbra.db'));

const BATCH_SIZE = 100; // rows per libsql batch transaction

// ─── Per-query timeout + stall detector ───
// Wraps remote.execute + remote.batch so any single query that hangs longer
// than QUERY_TIMEOUT_MS throws. A separate stall detector aborts the whole
// script if no progress is made for STALL_TIMEOUT_MS. Prevents the class of
// 2h-silent-hang incidents the lockfile alone doesn't catch.
const QUERY_TIMEOUT_MS = 120_000;   // single query ceiling
const STALL_TIMEOUT_MS = 5 * 60_000; // no-progress deadline
let lastProgressMs = Date.now();
function markProgress() { lastProgressMs = Date.now(); }

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`sync-push ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); markProgress(); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
const _origExecute = remote.execute.bind(remote);
remote.execute = ((arg: any) => withTimeout(_origExecute(arg), QUERY_TIMEOUT_MS, 'execute')) as typeof remote.execute;
const _origBatch = remote.batch.bind(remote);
remote.batch = ((args: any, mode?: any) => withTimeout(_origBatch(args, mode), QUERY_TIMEOUT_MS, 'batch')) as typeof remote.batch;

const stallInterval = setInterval(() => {
  const idle = Date.now() - lastProgressMs;
  if (idle > STALL_TIMEOUT_MS) {
    console.error(`FATAL: sync-push stalled — no progress for ${Math.round(idle / 1000)}s. Aborting to free Turso connections.`);
    try { require('fs').unlinkSync('/tmp/tbra-sync-push.lock'); } catch {}
    process.exit(3);
  }
}, 30_000).unref();
void stallInterval;

/**
 * Every drop is reported. `INSERT OR IGNORE` swallows UNIQUE/FK conflicts without
 * raising, and the per-row fallback used to `catch {}` outright, so this function
 * could discard any number of rows and still return to a caller that printed a
 * cheerful "✓ Pushed N". On 2026-07-30 that was hiding 549 books dropped every
 * single night — benign (they are duplicate rows whose identifier already belongs
 * to a live book), but a REAL regression would have looked exactly the same.
 * The counts are the only tell, so we surface them here rather than trusting
 * every call site to compare two numbers by eye.
 */
async function batchInsert(table: string, cols: string[], rows: any[][]) {
  if (rows.length === 0) return 0;
  const placeholders = cols.map(() => '?').join(',');
  const sql = `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`;
  let inserted = 0;
  const reasons = new Map<string, number>();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    try {
      const result = await remote.batch(
        chunk.map((row) => ({ sql, args: row })),
        'write'
      );
      for (const r of result as any[]) inserted += Number(r.rowsAffected || 0);
    } catch (e: any) {
      // 'write' mode rolls back on first FK failure — fall back to per-row inserts
      // so one bad row doesn't waste 99 good ones. Slower per-row but robust.
      for (const row of chunk) {
        try {
          const res = await remote.execute({ sql, args: row });
          inserted += Number(res.rowsAffected || 0);
        } catch (rowErr: any) {
          // Tally instead of discarding. Strip the row-specific tail so N failures
          // of the same kind collapse into one counted line.
          const msg = String(rowErr?.message ?? rowErr)
            .replace(/\s*\(.*$/, '')
            .slice(0, 120);
          reasons.set(msg, (reasons.get(msg) ?? 0) + 1);
        }
      }
    }
  }
  const skipped = rows.length - inserted;
  if (skipped > 0) {
    console.warn(`     ⚠ ${table}: ${skipped} of ${rows.length} row(s) NOT inserted`);
    if (reasons.size > 0) {
      [...reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([msg, n]) => console.warn(`         ${n}× ${msg}`));
    } else {
      // No exception was ever raised, so every drop came from OR IGNORE itself:
      // the row duplicates an existing PK, or collides on a UNIQUE index
      // (books: isbn_13 / open_library_key), or its FK target isn't live yet.
      console.warn(`         reason: INSERT OR IGNORE — row already on live, or a UNIQUE/FK constraint rejected it`);
    }
  }
  return inserted;
}

async function fetchIdSet(table: string, col = 'id'): Promise<Set<string>> {
  const set = new Set<string>();
  // Keyset pagination (2026-07-22): the old LIMIT/OFFSET walk made Turso
  // re-scan from row 0 for every page — O(n²) on 70k+ row tables. Walking the
  // unique column directly keeps every page O(page) and stays deterministic.
  let cursor: string | null = null;
  const page = 10000;
  while (true) {
    const r = await remote.execute(
      cursor === null
        ? { sql: `SELECT ${col} FROM ${table} ORDER BY ${col} LIMIT ${page}`, args: [] as any[] }
        : { sql: `SELECT ${col} FROM ${table} WHERE ${col} > ? ORDER BY ${col} LIMIT ${page}`, args: [cursor] }
    );
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) set.add(String(row[col]));
    cursor = String((r.rows[r.rows.length - 1] as any)[col]);
    if (r.rows.length < page) break;
  }
  return set;
}

function getCols(table: string): string[] {
  const rows = local.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.map((r) => r.name);
}

function rowsAsArrays(table: string, cols: string[], where = '', params: any[] = []): any[][] {
  const sql = `SELECT ${cols.join(',')} FROM ${table} ${where}`;
  const rows = local.prepare(sql).all(...params) as any[];
  return rows.map((r) => cols.map((c) => r[c]));
}

(async () => {
  console.log('→ Pushing local changes to Turso via @libsql/client\n');

  // ─── 0. LOCAL HYGIENE (delete orphaned junction rows) ─────────
  console.log('0/7  Local hygiene — deleting orphaned junction rows...');
  const CLEANUPS: Array<[string, string, string]> = [
    ['book_authors',          'book_id',   'books'],
    ['book_authors',          'author_id', 'authors'],
    ['book_genres',           'book_id',   'books'],
    ['book_genres',           'genre_id',  'genres'],
    ['book_series',           'book_id',   'books'],
    ['book_series',           'series_id', 'series'],
    ['book_category_ratings', 'book_id',   'books'],
    ['enrichment_log',        'book_id',   'books'],
  ];
  let cleaned = 0;
  for (const [tbl, fk, ref] of CLEANUPS) {
    try {
      const res = local
        .prepare(`DELETE FROM ${tbl} WHERE ${fk} NOT IN (SELECT id FROM ${ref})`)
        .run();
      if (res.changes > 0) {
        console.log(`     ✓ ${tbl}.${fk}: removed ${res.changes} orphaned rows`);
        cleaned += res.changes;
      }
    } catch (e: any) {
      console.log(`     ⚠ ${tbl}.${fk}: ${e.message.slice(0, 80)}`);
    }
  }
  console.log(`     Total: ${cleaned.toLocaleString()} orphaned rows removed`);

  // ─── 1. NEW BOOKS ─────────────────────────────────────────────
  console.log('1/7  Fetching live book IDs...');
  const liveBookIds = await fetchIdSet('books');
  console.log(`     ${liveBookIds.size.toLocaleString()} books already on live`);

  const bookCols = getCols('books');
  const allLocal = local.prepare('SELECT id FROM books').all() as any[];
  const newBookIds = allLocal.filter((r) => !liveBookIds.has(String(r.id))).map((r) => r.id);
  console.log(`     ${newBookIds.length.toLocaleString()} new books to push`);

  if (newBookIds.length > 0) {
    // Build placeholder IN clause for chunked fetches
    const newBookRows = rowsAsArrays(
      'books',
      bookCols,
      `WHERE id IN (${newBookIds.map(() => '?').join(',')})`,
      newBookIds
    );
    const inserted = await batchInsert('books', bookCols, newBookRows);
    console.log(`     ✓ Pushed ${inserted} new book rows`);
  }

  // ─── 2. NEW AUTHORS (full diff — not just for new books) ─────
  console.log('\n2/7  Pushing all new authors (full diff)...');
  const liveAuthorIds = await fetchIdSet('authors');
  const allLocalAuthorIds = (local.prepare('SELECT id FROM authors').all() as any[]).map((r) => r.id);
  const authorsToPush = allLocalAuthorIds.filter((id) => !liveAuthorIds.has(String(id)));
  if (authorsToPush.length > 0) {
    const aCols = getCols('authors');
    // Chunked fetch to avoid massive IN clause
    const aRows: any[][] = [];
    for (let i = 0; i < authorsToPush.length; i += 500) {
      const chunk = authorsToPush.slice(i, i + 500);
      const rows = rowsAsArrays('authors', aCols, `WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      aRows.push(...rows);
    }
    const n = await batchInsert('authors', aCols, aRows);
    console.log(`     ✓ Pushed ${n} / ${authorsToPush.length} new authors`);
  } else {
    console.log('     · No new authors needed');
  }

  // ─── 3. NEW SERIES (full diff) ────────────────────────────────
  console.log('\n3/7  Pushing all new series (full diff)...');
  const liveSeriesIds = await fetchIdSet('series');
  const allLocalSeriesIds = (local.prepare('SELECT id FROM series').all() as any[]).map((r) => r.id);
  const seriesToPush = allLocalSeriesIds.filter((id) => !liveSeriesIds.has(String(id)));
  if (seriesToPush.length > 0) {
    const cols = getCols('series');
    const rows: any[][] = [];
    for (let i = 0; i < seriesToPush.length; i += 500) {
      const chunk = seriesToPush.slice(i, i + 500);
      const r = rowsAsArrays('series', cols, `WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      rows.push(...r);
    }
    const n = await batchInsert('series', cols, rows);
    console.log(`     ✓ Pushed ${n} / ${seriesToPush.length} new series`);
  } else {
    console.log('     · No new series needed');
  }

  // ─── 4. NEW GENRES (full diff) ────────────────────────────────
  console.log('\n4/7  Pushing all new genres (full diff)...');
  const liveGenreIds = await fetchIdSet('genres');
  const allLocalGenreIds = (local.prepare('SELECT id FROM genres').all() as any[]).map((r) => r.id);
  const genresToPush = allLocalGenreIds.filter((id) => !liveGenreIds.has(String(id)));
  if (genresToPush.length > 0) {
    const cols = getCols('genres');
    const rows: any[][] = [];
    for (let i = 0; i < genresToPush.length; i += 500) {
      const chunk = genresToPush.slice(i, i + 500);
      const r = rowsAsArrays('genres', cols, `WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      rows.push(...r);
    }
    const n = await batchInsert('genres', cols, rows);
    console.log(`     ✓ Pushed ${n} / ${genresToPush.length} new genres`);
  } else {
    console.log('     · No new genres needed');
  }

  // ─── 5. JOIN TABLES for new books ─────────────────────────────
  console.log('\n5/7  Pushing join tables for new books...');
  if (newBookIds.length > 0) {
    const JOIN_TABLES = [
      'book_authors',
      'book_genres',
      'book_series',
      'book_category_ratings',
      'enrichment_log',
    ];
    for (const t of JOIN_TABLES) {
      try {
        const cols = getCols(t);
        if (cols.length === 0) continue;
        const rows = rowsAsArrays(
          t,
          cols,
          `WHERE book_id IN (${newBookIds.map(() => '?').join(',')})`,
          newBookIds
        );
        if (rows.length === 0) {
          console.log(`     · ${t}: no rows`);
          continue;
        }
        const n = await batchInsert(t, cols, rows);
        console.log(`     ✓ ${t}: pushed ${n} / ${rows.length} rows`);
      } catch (e: any) {
        console.log(`     ⚠ ${t}: ${e.message.slice(0, 100)}`);
      }
    }
  } else {
    console.log('     · Skipped (no new books)');
  }

  // ─── 5c. NEW JUNCTION ROWS for existing books ─────────────────
  // Enrichment adds new book_authors/book_genres/book_series/book_category_ratings/
  // enrichment_log rows for books that already exist on Turso. Push those too.
  //
  // Optimization: pre-filter against liveBookIds so FK failures don't force rollback of
  // an entire 100-row transactional batch. Orphaned local rows (book_id not on Turso)
  // are reported as a hygiene concern, not pushed.
  console.log('\n5c/7  Pushing new junction rows for existing books...');

  // Refresh live ID sets now that steps 1-4 have pushed. Any FK filter uses these.
  const liveBooksAfter = await fetchIdSet('books');
  const liveAuthorsAfter = await fetchIdSet('authors');
  const liveSeriesAfter = await fetchIdSet('series');
  const liveGenresAfter = await fetchIdSet('genres');

  // table, pk cols, [(col name, live set to check)]
  // book_category_ratings + enrichment_log are handled by the delta pass
  // BELOW this loop (2026-07-22) — at ~500k/~300k live rows, building their
  // full live PK sets here was the CPU hang that got whole pushes watchdog-
  // reaped at step 5c on 2026-07-19/20 (so 5e never ran either).
  const JUNCTION_TABLES: Array<[string, string[], Array<[string, Set<string>]>]> = [
    ['book_authors',          ['book_id', 'author_id'],   [['book_id', liveBooksAfter], ['author_id', liveAuthorsAfter]]],
    ['book_genres',           ['book_id', 'genre_id'],    [['book_id', liveBooksAfter], ['genre_id',  liveGenresAfter]]],
    ['book_series',           ['book_id', 'series_id'],   [['book_id', liveBooksAfter], ['series_id', liveSeriesAfter]]],
  ];

  for (const [tbl, pk, fkChecks] of JUNCTION_TABLES) {
    try {
      const cols = getCols(tbl);
      if (cols.length === 0) continue;

      // Build live PK set — rowid keyset walk (2026-07-22); the old
      // LIMIT/OFFSET pagination re-scanned from row 0 every page.
      const liveSet = new Set<string>();
      {
        let cursor = -1;
        const page = 20000;
        while (true) {
          const r = await remote.execute({
            sql: `SELECT ${pk.join(',')}, rowid AS __rid FROM ${tbl} WHERE rowid > ? ORDER BY rowid LIMIT ${page}`,
            args: [cursor],
          });
          if (r.rows.length === 0) break;
          for (const row of r.rows as any[]) liveSet.add(pk.map((c) => String(row[c])).join('\x1f'));
          cursor = Number((r.rows[r.rows.length - 1] as any).__rid);
          if (r.rows.length < page) break;
        }
      }

      // Pre-filter: drop rows whose FKs aren't present on Turso
      const localRows = local.prepare(`SELECT ${cols.join(',')} FROM ${tbl}`).all() as any[];
      const toPush: any[][] = [];
      let orphanedCount = 0;
      for (const r of localRows) {
        let ok = true;
        for (const [fkCol, fkSet] of fkChecks) {
          if (r[fkCol] != null && !fkSet.has(String(r[fkCol]))) { ok = false; break; }
        }
        if (!ok) { orphanedCount++; continue; }
        const key = pk.map((c) => String(r[c])).join('\x1f');
        if (!liveSet.has(key)) toPush.push(cols.map((c) => r[c]));
      }

      if (toPush.length === 0) {
        const orphanNote = orphanedCount > 0 ? ` (${orphanedCount} orphaned local rows skipped)` : '';
        console.log(`     · ${tbl}: in sync (live has ${liveSet.size.toLocaleString()} rows)${orphanNote}`);
        continue;
      }

      const n = await batchInsert(tbl, cols, toPush);
      const orphanNote = orphanedCount > 0 ? ` [${orphanedCount} orphaned rows skipped]` : '';
      console.log(`     ✓ ${tbl}: pushed ${n} / ${toPush.length} missing rows${orphanNote}`);
    } catch (e: any) {
      console.log(`     ⚠ ${tbl}: ${e.message.slice(0, 120)}`);
    }
  }

  // ─── 5c-delta: big junction tables via timestamp window ───────
  // (2026-07-22) book_category_ratings (~500k) and enrichment_log (~300k)
  // can't be full-diffed like the tables above — building their live PK sets
  // was a 20+ minute CPU hang that got whole pushes watchdog-reaped. Every
  // local write to these tables stamps a fresh timestamp, so only recent
  // local rows can be unpushed: take a generous 21-day window, FK-filter,
  // ask live which of exactly those ids it already has (chunked IN), and
  // insert the missing ones. INSERT OR IGNORE semantics unchanged.
  const DELTA_JUNCTION: Array<[string, string]> = [
    ['book_category_ratings', 'updated_at'],
    ['enrichment_log',        'created_at'],
  ];
  for (const [tbl, dcol] of DELTA_JUNCTION) {
    try {
      const cols = getCols(tbl);
      if (cols.length === 0) continue;
      const candidates = local.prepare(
        `SELECT ${cols.join(',')} FROM ${tbl} WHERE ${dcol} > datetime('now', '-21 days')`
      ).all() as any[];
      let orphaned = 0;
      const eligible = candidates.filter((r: any) => {
        if (r.book_id != null && !liveBooksAfter.has(String(r.book_id))) { orphaned++; return false; }
        return true;
      });

      const liveHas = new Set<string>();
      for (let i = 0; i < eligible.length; i += 400) {
        const chunk = eligible.slice(i, i + 400);
        const r = await remote.execute({
          sql: `SELECT id FROM ${tbl} WHERE id IN (${chunk.map(() => '?').join(',')})`,
          args: chunk.map((c: any) => c.id),
        });
        for (const row of r.rows as any[]) liveHas.add(String(row.id));
      }

      const toPush = eligible
        .filter((r: any) => !liveHas.has(String(r.id)))
        .map((r: any) => cols.map((c) => r[c]));
      const orphanNote = orphaned > 0 ? ` [${orphaned} orphaned rows skipped]` : '';
      if (toPush.length === 0) {
        console.log(`     · ${tbl}: in sync (checked ${eligible.length.toLocaleString()} recent rows)${orphanNote}`);
        continue;
      }
      const n = await batchInsert(tbl, cols, toPush);
      console.log(`     ✓ ${tbl}: pushed ${n} / ${toPush.length} missing recent rows${orphanNote}`);
    } catch (e: any) {
      console.log(`     ⚠ ${tbl}: ${e.message.slice(0, 120)}`);
    }
  }

  // ─── 5b. UPDATE existing books where local is newer ──────────
  console.log('\n5b/7  Pushing metadata updates for existing books...');
  // Fields that can be improved by enrichment — safe to push on updated_at > remote.
  // NEVER overwrites id, slug, visibility, needs_review, created_at (admin-managed / stable).
  const UPDATE_FIELDS = [
    'summary', 'description', 'publication_year', 'pages', 'publisher',
    'cover_image_url', 'is_fiction', 'is_box_set', 'pacing',
    'audiobook_cover_url', 'cover_verified', 'cover_source',
    // `language` was missing until 2026-07-30: enrichment has been writing it
    // locally for months and it never reached Turso, so prod had ~2,600 blank
    // language values whose answer was already sitting in the local DB. It is
    // ordinary metadata like publisher — safe to push. (Demotion of non-English
    // books stays a separate, manual step: scripts/hide-non-english.ts.)
    'language',
    'description_stale', 'updated_at',
  ];

  // Pull Turso's updated_at map (books only — one query)
  const liveUpdated = new Map<string, string | null>();
  {
    let offset = 0;
    const page = 10000;
    while (true) {
      const r = await remote.execute(
        `SELECT id, updated_at FROM books ORDER BY id LIMIT ${page} OFFSET ${offset}`
      );
      if (r.rows.length === 0) break;
      for (const row of r.rows as any[]) liveUpdated.set(String(row.id), row.updated_at);
      if (r.rows.length < page) break;
      offset += page;
    }
  }

  // Pick local books where local.updated_at > live.updated_at (and book exists on live)
  const localBooks = local
    .prepare(`SELECT id, ${UPDATE_FIELDS.join(',')} FROM books WHERE updated_at IS NOT NULL`)
    .all() as any[];

  const toUpdate: any[] = [];
  for (const b of localBooks) {
    const live = liveUpdated.get(String(b.id));
    if (live === undefined) continue; // not on live; handled by "new books" step 1
    if (!live || String(b.updated_at) > String(live)) {
      toUpdate.push(b);
    }
  }

  console.log(`     ${toUpdate.length.toLocaleString()} existing books have newer local metadata`);

  if (toUpdate.length > 0) {
    const setClause = UPDATE_FIELDS.map((c) => `${c} = ?`).join(', ');
    const sql = `UPDATE books SET ${setClause} WHERE id = ?`;
    let updated = 0;
    let errors = 0;
    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const chunk = toUpdate.slice(i, i + BATCH_SIZE);
      try {
        const result = await remote.batch(
          chunk.map((b: any) => ({
            sql,
            args: [...UPDATE_FIELDS.map((c) => b[c]), b.id],
          })),
          'write'
        );
        for (const r of result as any[]) updated += Number(r.rowsAffected || 0);
      } catch (e: any) {
        errors += chunk.length;
        console.log(`     ⚠  update batch @ ${i}: ${e.message.slice(0, 120)}`);
      }
      if (i > 0 && i % 1000 === 0) console.log(`     ...${updated} updated so far`);
    }
    console.log(`     ✓ Updated ${updated} book rows (errors: ${errors})`);
  }

  // ─── 5d. NYT BESTSELLER CACHE (mirror local → Turso) ──────────
  // INSERT OR REPLACE (not OR IGNORE) so improved descriptions / better ranks
  // captured locally propagate to production, where user-import enrichment reads
  // this table. Local is authoritative; we never delete from it, so no removals.
  console.log('\n5d   NYT bestseller cache (nyt_bestsellers)...');
  await remote.execute(`
    CREATE TABLE IF NOT EXISTS nyt_bestsellers (
      id TEXT PRIMARY KEY NOT NULL,
      isbn_13 TEXT, isbn_10 TEXT, title TEXT NOT NULL, author TEXT, title_key TEXT,
      description TEXT, publisher TEXT, book_image TEXT, amazon_url TEXT,
      first_list_name TEXT, best_rank INTEGER, weeks_on_list INTEGER,
      first_published_date TEXT,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await remote.execute(`CREATE UNIQUE INDEX IF NOT EXISTS nyt_isbn13_unique ON nyt_bestsellers (isbn_13)`);
  await remote.execute(`CREATE INDEX IF NOT EXISTS nyt_title_key_idx ON nyt_bestsellers (title_key)`);
  try {
    const cols = getCols('nyt_bestsellers');
    if (cols.length === 0) {
      console.log('     · nyt_bestsellers: not in local DB');
    } else {
      const rows = rowsAsArrays('nyt_bestsellers', cols);
      const placeholders = cols.map(() => '?').join(',');
      const sql = `INSERT OR REPLACE INTO nyt_bestsellers (${cols.join(',')}) VALUES (${placeholders})`;
      let pushed = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        try {
          const result = await remote.batch(chunk.map((r) => ({ sql, args: r })), 'write');
          for (const r of result as any[]) pushed += Number(r.rowsAffected || 0);
        } catch {
          for (const row of chunk) {
            try { const res = await remote.execute({ sql, args: row }); pushed += Number(res.rowsAffected || 0); }
            catch { /* skip bad row */ }
          }
        }
      }
      console.log(`     ✓ nyt_bestsellers: mirrored ${pushed} / ${rows.length} rows`);
    }
  } catch (e: any) {
    console.log(`     ⚠ nyt_bestsellers: ${e.message.slice(0, 120)}`);
  }

  // ─── 5e. NEW reported_issues (local-created flags → live) ─────
  // reported_issues is BIDIRECTIONAL: users file reports on live, admins resolve
  // them on live, and nightly-junk-sweep / key-health create rows locally. We must
  // push local-created rows (e.g. [AUTO-FLAG: junk-sweep] box-set flags) WITHOUT ever
  // overwriting a live row — an admin may have already resolved it on Turso. So:
  // diff by id, INSERT OR IGNORE only the local ids not present on live. Pre-filter
  // book_id against liveBooksAfter so a flag on a not-yet-synced book doesn't roll
  // back the batch (batchInsert's per-row fallback also skips residual FK failures).
  // Fixes the long-standing gap where junk-sweep flags never reached /admin/issues on
  // live and had to be pushed by hand each night.
  console.log('\n5e   New reported_issues (local-created flags)...');
  try {
    const cols = getCols('reported_issues');
    if (cols.length === 0) {
      console.log('     · reported_issues: not in local DB');
    } else {
      const liveIssueIds = await fetchIdSet('reported_issues');
      const localIssues = local
        .prepare(`SELECT ${cols.join(',')} FROM reported_issues`)
        .all() as any[];
      let orphanedCount = 0;
      const toPush: any[][] = [];
      for (const r of localIssues) {
        if (liveIssueIds.has(String(r.id))) continue; // already on live — never overwrite
        if (r.book_id != null && !liveBooksAfter.has(String(r.book_id))) {
          orphanedCount++;
          continue; // flag references a book not yet on live — skip (would FK-fail)
        }
        toPush.push(cols.map((c) => r[c]));
      }
      if (toPush.length === 0) {
        const note = orphanedCount > 0 ? ` (${orphanedCount} referenced a book not on live — skipped)` : '';
        console.log(`     · reported_issues: in sync (live has ${liveIssueIds.size.toLocaleString()} rows)${note}`);
      } else {
        const n = await batchInsert('reported_issues', cols, toPush);
        const note = orphanedCount > 0 ? ` [${orphanedCount} orphaned book_id skipped]` : '';
        console.log(`     ✓ reported_issues: pushed ${n} / ${toPush.length} new local rows${note}`);
      }
    }
  } catch (e: any) {
    console.log(`     ⚠ reported_issues: ${e.message.slice(0, 120)}`);
  }

  // ─── 5g. NEW editions (local-recorded printings → live) ─────
  // `editions` was in sync-PULL but NOT sync-push — editions were only ever
  // created on live by the picker, so nothing local needed pushing. That
  // stopped being true when ingestion started folding decorated titles onto
  // the canon book and recording the printing as an edition row: the nightly
  // lanes (discovery, breadth-import, upcoming-releases) all write LOCAL, so
  // without this step every locally-recorded deluxe/anniversary printing would
  // be stranded and never appear in a reader's picker on prod.
  //
  // Append-only and id-diffed, same contract as 5e: a live row is never
  // overwritten. book_id is pre-filtered against liveBooksAfter so an edition
  // on a not-yet-synced book can't FK-fail the batch.
  console.log('\n5g   New editions (local-recorded printings)...');
  try {
    const cols = getCols('editions');
    if (cols.length === 0) {
      console.log('     · editions: not in local DB');
    } else {
      const liveEditionIds = await fetchIdSet('editions');
      const localEditions = local
        .prepare(`SELECT ${cols.join(',')} FROM editions`)
        .all() as any[];
      let orphanedCount = 0;
      const toPush: any[][] = [];
      for (const r of localEditions) {
        if (liveEditionIds.has(String(r.id))) continue;
        if (r.book_id != null && !liveBooksAfter.has(String(r.book_id))) {
          orphanedCount++;
          continue;
        }
        toPush.push(cols.map((c) => r[c]));
      }
      if (toPush.length === 0) {
        const note = orphanedCount > 0 ? ` (${orphanedCount} referenced a book not on live — skipped)` : '';
        console.log(`     · editions: in sync (live has ${liveEditionIds.size.toLocaleString()} rows)${note}`);
      } else {
        const n = await batchInsert('editions', cols, toPush);
        const note = orphanedCount > 0 ? ` [${orphanedCount} orphaned book_id skipped]` : '';
        console.log(`     ✓ editions: pushed ${n} / ${toPush.length} new local rows${note}`);
      }
    }
  } catch (e: any) {
    console.log(`     ⚠ editions: ${e.message.slice(0, 120)}`);
  }

  // ─── 5f. up_next queues where LOCAL is newer (app edits → live) ─────
  // Mirror of sync-pull's whole-queue step: the queue syncs as ONE UNIT per
  // user (deletes/reorders leave no per-row trace), newest side wins by
  // MAX(COALESCE(updated_at, added_at)). Pull handles live-newer; this step
  // pushes queues the native app touched more recently. A user with rows
  // ONLY on live is left alone (ambiguous — never destroy data).
  console.log('\n5f   up_next queues (local-newer → live)...');
  try {
    const liveQueueRows = (await remote.execute(
      'SELECT user_id, MAX(COALESCE(updated_at, added_at)) AS m FROM up_next GROUP BY user_id'
    )).rows as any[];
    const liveMax = new Map(liveQueueRows.map((r: any) => [String(r.user_id), String(r.m ?? '')]));
    const localQueues = local.prepare(
      'SELECT id, user_id, book_id, position, added_at, updated_at FROM up_next ORDER BY user_id, position'
    ).all() as any[];
    const byUser = new Map<string, any[]>();
    for (const r of localQueues) {
      const key = String(r.user_id);
      const list = byUser.get(key) ?? [];
      list.push(r);
      byUser.set(key, list);
    }
    let pushed = 0;
    let skippedFk = 0;
    for (const [userId, rows] of byUser) {
      const localMax = rows.reduce((m, r) => {
        const v = String(r.updated_at ?? r.added_at ?? '');
        return v > m ? v : m;
      }, '');
      if ((liveMax.get(userId) ?? '') >= localMax) continue; // live same-or-newer
      const insertable = rows.filter((r) => liveBooksAfter.has(String(r.book_id)));
      skippedFk += rows.length - insertable.length;
      await remote.batch([
        { sql: 'DELETE FROM up_next WHERE user_id = ?', args: [userId] },
        ...insertable.map((r) => ({
          sql: 'INSERT INTO up_next (id, user_id, book_id, position, added_at, updated_at) VALUES (?,?,?,?,?,?)',
          args: [r.id, r.user_id, r.book_id, r.position, r.added_at, r.updated_at ?? null],
        })),
      ], 'write');
      pushed++;
    }
    markProgress();
    const note = skippedFk ? ` [${skippedFk} row(s) skipped — book not on live]` : '';
    if (pushed === 0) console.log('     · up_next: all queues in sync (or live newer)');
    else console.log(`     ✓ up_next: mirrored ${pushed} local-newer queue(s) → live${note}`);
  } catch (e: any) {
    console.log(`     ⚠ up_next: ${e.message.slice(0, 120)}`);
  }

  // ─── 6. LANDING PAGE TABLES (full replace) ────────────────────
  console.log('\n6/7  Syncing landing page tables (full replace)...');
  // Ensure tables exist on Turso
  await remote.execute(`
    CREATE TABLE IF NOT EXISTS landing_page_books (
      id TEXT PRIMARY KEY,
      book_slug TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'parade',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await remote.execute(`
    CREATE TABLE IF NOT EXISTS landing_page_copy (
      id TEXT PRIMARY KEY,
      section_key TEXT NOT NULL UNIQUE,
      section_label TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  for (const lp of ['landing_page_books', 'landing_page_copy']) {
    try {
      const cols = getCols(lp);
      if (cols.length === 0) {
        console.log(`     · ${lp}: not in local DB`);
        continue;
      }
      const rows = rowsAsArrays(lp, cols);
      await remote.execute(`DELETE FROM ${lp}`);
      // Use plain INSERT (no OR IGNORE) to allow the full replace
      const placeholders = cols.map(() => '?').join(',');
      const sql = `INSERT INTO ${lp} (${cols.join(',')}) VALUES (${placeholders})`;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        await remote.batch(
          chunk.map((r) => ({ sql, args: r })),
          'write'
        );
      }
      console.log(`     ✓ ${lp}: replaced with ${rows.length} rows`);
    } catch (e: any) {
      console.log(`     ⚠ ${lp}: ${e.message.slice(0, 100)}`);
    }
  }

  // ─── 7. SUMMARY ───────────────────────────────────────────────
  console.log('\n7/7  Done.');
  const remoteBookCount = await remote.execute('SELECT count(*) as n FROM books');
  console.log(`     Books on Turso: ${Number((remoteBookCount.rows[0] as any).n).toLocaleString()}`);

  local.close();
  // The Turso libSQL client keeps an open socket that holds the event loop
  // alive after all work is done. Without an explicit exit the process hangs
  // until the unref'd stall watchdog fires and kills it with exit 3 (same
  // class of bug fixed in sync-pull.ts on 2026-06-25). The 'exit' handler
  // (line ~47) clears the lockfile.
  try { remote.close(); } catch {}
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
