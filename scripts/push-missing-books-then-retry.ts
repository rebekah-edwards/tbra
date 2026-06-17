/**
 * push-missing-books-then-retry.ts
 *
 * Diagnostic + fix for the FK constraint errors during taxonomy migration push.
 *
 * The migration created book_category_ratings rows for all 48K rated books,
 * but some of those book_ids exist only locally (not yet pushed to Turso).
 * Those rating rows fail FK on Turso.
 *
 * This script:
 *   1. Diff local books vs Turso books → find missing book_ids
 *   2. Also diff authors/series/genres (so junction tables won't break)
 *   3. Push missing books/authors/series/genres and their junctions
 *   4. Retry any still-missing book_category_ratings rows
 */

require("dotenv").config({ path: ".env.vercel.local" });
const { createClient } = require("@libsql/client");
const Database = require("better-sqlite3");
const path = require("path");

const remote = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const local = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });

const CHUNK = 200;

async function fetchAllIds(table: string, pk = "id"): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  const pageSize = 5000;
  while (true) {
    const r = await remote.execute(
      `SELECT ${pk} FROM ${table} ORDER BY ${pk} LIMIT ${pageSize} OFFSET ${offset}`,
    );
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) ids.add(String(row[pk]));
    if (r.rows.length < pageSize) break;
    offset += pageSize;
  }
  return ids;
}

function localIds(table: string, pk = "id"): Set<string> {
  const rows = local.prepare(`SELECT ${pk} FROM ${table}`).all() as any[];
  return new Set(rows.map((r) => String(r[pk])));
}

async function pushMissingRows(
  table: string,
  missingIds: Set<string>,
  cols: string[],
): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  const ids = [...missingIds];
  console.log(`  pushing ${ids.length} ${table} rows`);

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = local
      .prepare(`SELECT ${cols.join(",")} FROM ${table} WHERE id IN (${placeholders})`)
      .all(...chunk) as any[];

    const statements = rows.map((r) => ({
      sql: `INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      args: cols.map((c) => r[c]),
    }));

    try {
      await remote.batch(statements, "write");
      ok += rows.length;
    } catch (e: any) {
      fail += rows.length;
      console.error(`    ✗ ${table} batch ${Math.floor(i / CHUNK) + 1} failed: ${e.message.slice(0, 140)}`);
    }
  }
  return { ok, fail };
}

(async () => {
  const t0 = Date.now();
  console.log("→ Diffing local vs Turso for books/authors/series/genres\n");

  const [localBooks, remoteBooks] = [localIds("books"), await fetchAllIds("books")];
  const missingBooks = new Set([...localBooks].filter((id) => !remoteBooks.has(id)));
  console.log(`  books:   local ${localBooks.size}, remote ${remoteBooks.size}, missing ${missingBooks.size}`);

  const [localAuthors, remoteAuthors] = [localIds("authors"), await fetchAllIds("authors")];
  const missingAuthors = new Set([...localAuthors].filter((id) => !remoteAuthors.has(id)));
  console.log(`  authors: local ${localAuthors.size}, remote ${remoteAuthors.size}, missing ${missingAuthors.size}`);

  const [localSeries, remoteSeries] = [localIds("series"), await fetchAllIds("series")];
  const missingSeries = new Set([...localSeries].filter((id) => !remoteSeries.has(id)));
  console.log(`  series:  local ${localSeries.size}, remote ${remoteSeries.size}, missing ${missingSeries.size}`);

  const [localGenres, remoteGenres] = [localIds("genres"), await fetchAllIds("genres")];
  const missingGenres = new Set([...localGenres].filter((id) => !remoteGenres.has(id)));
  console.log(`  genres:  local ${localGenres.size}, remote ${remoteGenres.size}, missing ${missingGenres.size}`);

  // Book columns — copied from sync-push pattern
  const bookCols = local
    .prepare(`PRAGMA table_info(books)`)
    .all()
    .map((r: any) => r.name);
  const authorCols = local
    .prepare(`PRAGMA table_info(authors)`)
    .all()
    .map((r: any) => r.name);
  const seriesCols = local
    .prepare(`PRAGMA table_info(series)`)
    .all()
    .map((r: any) => r.name);
  const genreCols = local
    .prepare(`PRAGMA table_info(genres)`)
    .all()
    .map((r: any) => r.name);

  // Push in dependency order: authors, series, genres, then books
  console.log(`\n→ Pushing missing rows`);
  if (missingAuthors.size > 0) {
    const r = await pushMissingRows("authors", missingAuthors, authorCols);
    console.log(`  authors: ${r.ok} ok, ${r.fail} failed`);
  }
  if (missingSeries.size > 0) {
    const r = await pushMissingRows("series", missingSeries, seriesCols);
    console.log(`  series: ${r.ok} ok, ${r.fail} failed`);
  }
  if (missingGenres.size > 0) {
    const r = await pushMissingRows("genres", missingGenres, genreCols);
    console.log(`  genres: ${r.ok} ok, ${r.fail} failed`);
  }
  if (missingBooks.size > 0) {
    const r = await pushMissingRows("books", missingBooks, bookCols);
    console.log(`  books: ${r.ok} ok, ${r.fail} failed`);
  }

  // Now retry the book_category_ratings push — only rows that are still missing
  // or stale on Turso
  console.log(`\n→ Retrying book_category_ratings (touched today)`);
  const rows = local
    .prepare(
      `SELECT id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at
         FROM book_category_ratings
        WHERE updated_at >= date('now')
        ORDER BY book_id`,
    )
    .all() as any[];
  console.log(`  ${rows.length} rows to retry`);

  let pushed = 0;
  let failed = 0;
  let batchNum = 0;
  const totalBatches = Math.ceil(rows.length / CHUNK);
  const failedBookIds = new Set<string>();

  for (let i = 0; i < rows.length; i += CHUNK) {
    batchNum++;
    const chunk = rows.slice(i, i + CHUNK);
    const statements = chunk.map((r) => ({
      sql: `INSERT OR REPLACE INTO book_category_ratings
              (id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id,
        r.book_id,
        r.category_id,
        r.intensity,
        r.notes,
        r.evidence_level,
        r.updated_by_user_id,
        r.updated_at,
      ],
    }));

    try {
      await remote.batch(statements, "write");
      pushed += chunk.length;
    } catch (e: any) {
      failed += chunk.length;
      for (const r of chunk) failedBookIds.add(r.book_id);
    }

    if (batchNum % 50 === 0 || batchNum === totalBatches) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  batch ${batchNum}/${totalBatches}  pushed=${pushed} failed=${failed}  elapsed=${elapsed}s`);
    }
  }

  console.log(`\n────────────────────────────────────`);
  console.log(`book_category_ratings: ${pushed} pushed, ${failed} failed`);
  if (failedBookIds.size > 0) {
    console.log(`Unique failed book_ids: ${failedBookIds.size}`);
    console.log(`First 5 failed book_ids:`, [...failedBookIds].slice(0, 5));
  }
  console.log(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  local.close();
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
