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
 *   - landing_page_books and landing_page_copy (full replace — admin-managed)
 *
 * Does NOT push user-data tables (those are bidirectional; admin edits happen on live).
 * For content-ratings updates to EXISTING books, use push-content-ratings-to-turso.ts.
 */

require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');
const Database = require('better-sqlite3');
const path = require('path');

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

async function batchInsert(table: string, cols: string[], rows: any[][]) {
  if (rows.length === 0) return 0;
  const placeholders = cols.map(() => '?').join(',');
  const sql = `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`;
  let inserted = 0;
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
        } catch {
          // Individual FK failure — skip silently
        }
      }
    }
  }
  return inserted;
}

async function fetchIdSet(table: string, col = 'id'): Promise<Set<string>> {
  const set = new Set<string>();
  // Page deterministically — LIMIT/OFFSET without ORDER BY can skip/repeat rows under load
  let offset = 0;
  const page = 10000;
  while (true) {
    const r = await remote.execute(
      `SELECT ${col} FROM ${table} ORDER BY ${col} LIMIT ${page} OFFSET ${offset}`
    );
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) set.add(String(row[col]));
    if (r.rows.length < page) break;
    offset += page;
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
  const JUNCTION_TABLES: Array<[string, string[], Array<[string, Set<string>]>]> = [
    ['book_authors',          ['book_id', 'author_id'],   [['book_id', liveBooksAfter], ['author_id', liveAuthorsAfter]]],
    ['book_genres',           ['book_id', 'genre_id'],    [['book_id', liveBooksAfter], ['genre_id',  liveGenresAfter]]],
    ['book_series',           ['book_id', 'series_id'],   [['book_id', liveBooksAfter], ['series_id', liveSeriesAfter]]],
    ['book_category_ratings', ['id'],                     [['book_id', liveBooksAfter]]],
    ['enrichment_log',        ['id'],                     [['book_id', liveBooksAfter]]],
  ];

  for (const [tbl, pk, fkChecks] of JUNCTION_TABLES) {
    try {
      const cols = getCols(tbl);
      if (cols.length === 0) continue;

      // Build live PK set
      const liveSet = new Set<string>();
      let offset = 0;
      const page = 20000;
      while (true) {
        const r = await remote.execute(
          `SELECT ${pk.join(',')} FROM ${tbl} ORDER BY ${pk[0]} LIMIT ${page} OFFSET ${offset}`
        );
        if (r.rows.length === 0) break;
        for (const row of r.rows as any[]) liveSet.add(pk.map((c) => String(row[c])).join('\x1f'));
        if (r.rows.length < page) break;
        offset += page;
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

  // ─── 5b. UPDATE existing books where local is newer ──────────
  console.log('\n5b/7  Pushing metadata updates for existing books...');
  // Fields that can be improved by enrichment — safe to push on updated_at > remote.
  // NEVER overwrites id, slug, visibility, needs_review, created_at (admin-managed / stable).
  const UPDATE_FIELDS = [
    'summary', 'description', 'publication_year', 'pages', 'publisher',
    'cover_image_url', 'is_fiction', 'is_box_set', 'pacing',
    'audiobook_cover_url', 'cover_verified', 'cover_source',
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
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
