/**
 * fix-slug-collisions.ts
 *
 * Fixes the Midnight-Is-the-Darkest-Hour pattern: books where the same slug
 * exists on both local and Turso but with different primary keys. Symptom on
 * production: users see a partially-enriched shell because sync-push matches
 * by id and the local fully-enriched copy never reached the Turso row users
 * actually interact with.
 *
 * Strategy — patch Turso in place:
 *   - Update books row with enrichment fields from local canonical
 *   - Replace book_category_ratings with local's set (generates new UUIDs)
 *   - INSERT OR IGNORE book_genres from local
 *   - INSERT OR IGNORE book_authors from local (in case local has more authors)
 *   - INSERT OR IGNORE book_series from local (filtered by existing Turso series)
 *   - Preserve ALL user activity on Turso (user_book_state, ratings, reviews,
 *     reading_sessions, favorites, etc.) — never touched.
 *
 * Accepts long-term tech debt: IDs remain divergent. Deferred reconciliation
 * in a future pass. Live site renders correctly immediately.
 *
 * Reads the latest reports/slug-collision-audit-*.json as its input manifest.
 *
 * Dry-run by default. Pass --apply to mutate.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { Client } from "@libsql/client";
import { randomUUID, createHash } from "crypto";
import { config } from "dotenv";
import { createGuardedTurso } from "./lib/turso-guard";

void createHash; // imported for future use; referenced here to silence tsc

config({ path: ".env.vercel.local" });
const APPLY = process.argv.includes("--apply");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : Infinity;
// Rate-limit knobs. Defaults tuned so a user actively browsing the site
// doesn't notice: ~10 queries/sec into Turso, with a cooldown between chunks
// so the connection pool fully drains.
const CHUNK_SIZE = parseInt(
  process.argv.find((a) => a.startsWith("--chunk="))?.split("=")[1] ?? "10",
  10,
);
const PAUSE_MS = parseInt(
  process.argv.find((a) => a.startsWith("--pause="))?.split("=")[1] ?? "100",
  10,
);
const COOLDOWN_SEC = parseInt(
  process.argv.find((a) => a.startsWith("--cooldown="))?.split("=")[1] ?? "30",
  10,
);

async function sleep(ms: number) {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

const localDb = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });

// Turso client — initialized inside main() via createGuardedTurso so the
// run gets the watchdog-exemption longRunning lockfile and a wall-clock
// ceiling. Without longRunning:true the launchd watchdog kills the script
// at the 60-min mark — exactly what happened on 2026-05-04 (chunk 129/438).
let turso: Client;

// Locate latest manifest
function resolveManifest(): string {
  const dir = path.join(process.cwd(), "reports");
  const files = fs.readdirSync(dir).filter((f) => /^slug-collision-audit-.*\.json$/.test(f));
  if (files.length === 0) throw new Error("No slug-collision-audit manifest found. Run scripts/audit-slug-collisions.ts first.");
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

interface Pair {
  slug: string;
  local: { id: string; title: string };
  turso: { id: string; title: string };
}

// Enrichment fields to copy on the books row
const BOOK_FIELDS = [
  "cover_image_url", "cover_source", "cover_verified",
  "description", "summary", "publication_year", "pages", "publisher",
  "is_fiction", "is_box_set", "pacing",
  "open_library_key", "isbn_13", "isbn_10", "asin",
  "publication_date", "language",
  "audiobook_cover_url", "description_stale",
] as const;

async function getTursoBookIdSet(): Promise<Set<string>> {
  const set = new Set<string>();
  const PAGE = 5000;
  let offset = 0;
  while (true) {
    const res = await turso.execute({ sql: `SELECT id FROM books LIMIT ? OFFSET ?`, args: [PAGE, offset] });
    if (res.rows.length === 0) break;
    for (const r of res.rows) set.add(String(r.id));
    if (res.rows.length < PAGE) break;
    offset += PAGE;
  }
  return set;
}

async function getTursoSeriesIdSet(): Promise<Set<string>> {
  const set = new Set<string>();
  const PAGE = 5000;
  let offset = 0;
  while (true) {
    const res = await turso.execute({ sql: `SELECT id FROM series LIMIT ? OFFSET ?`, args: [PAGE, offset] });
    if (res.rows.length === 0) break;
    for (const r of res.rows) set.add(String(r.id));
    if (res.rows.length < PAGE) break;
    offset += PAGE;
  }
  return set;
}

async function getTursoAuthorIdSet(): Promise<Set<string>> {
  const set = new Set<string>();
  const PAGE = 5000;
  let offset = 0;
  while (true) {
    const res = await turso.execute({ sql: `SELECT id FROM authors LIMIT ? OFFSET ?`, args: [PAGE, offset] });
    if (res.rows.length === 0) break;
    for (const r of res.rows) set.add(String(r.id));
    if (res.rows.length < PAGE) break;
    offset += PAGE;
  }
  return set;
}

async function getTursoGenreIdSet(): Promise<Set<string>> {
  const set = new Set<string>();
  const PAGE = 5000;
  let offset = 0;
  while (true) {
    const res = await turso.execute({ sql: `SELECT id FROM genres LIMIT ? OFFSET ?`, args: [PAGE, offset] });
    if (res.rows.length === 0) break;
    for (const r of res.rows) set.add(String(r.id));
    if (res.rows.length < PAGE) break;
    offset += PAGE;
  }
  return set;
}

/**
 * When the books-row UPDATE hits a UNIQUE conflict on isbn_13/isbn_10/asin/
 * open_library_key, those identifiers belong to a different ISBN-edition that
 * Turso already knows about under another book. Rather than dropping the data,
 * we capture local's identifying fields as a row in the `editions` table
 * pointing at the canonical Turso book — that's exactly what `editions` is for.
 *
 * Constraint: editions.open_library_key is NOT NULL UNIQUE. Three cases:
 *   1. Local has an OL key + that key isn't already in editions → use it.
 *   2. Local has an OL key but it's already used by another edition row → fall
 *      through to a synthetic key.
 *   3. Local has no OL key → synthetic.
 *
 * Synthetic keys are namespaced as `synthetic:isbn:<isbn>` (or random UUID
 * fallback) so consumers that don't parse the field beyond uniqueness don't
 * trip on them. Returns true if an edition row was created, false otherwise.
 */
async function maybeCreateEditionForLocalSide(
  localBookId: string,
  tursoBookId: string,
): Promise<boolean> {
  const localExt = localDb
    .prepare(
      `SELECT title, isbn_13, isbn_10, open_library_key, publication_date,
              publisher, pages, cover_image_url
       FROM books WHERE id = ?`,
    )
    .get(localBookId) as
    | {
        title: string | null;
        isbn_13: string | null;
        isbn_10: string | null;
        open_library_key: string | null;
        publication_date: string | null;
        publisher: string | null;
        pages: number | null;
        cover_image_url: string | null;
      }
    | undefined;
  if (!localExt) return false;
  // No identifying data → nothing worth saving as an edition
  if (!localExt.isbn_13 && !localExt.isbn_10 && !localExt.open_library_key) {
    return false;
  }

  // Decide on open_library_key for the edition row (NOT NULL UNIQUE)
  let editionOlKey: string;
  if (localExt.open_library_key) {
    await sleep(PAUSE_MS);
    const r = await turso.execute({
      sql: `SELECT 1 FROM editions WHERE open_library_key = ? LIMIT 1`,
      args: [localExt.open_library_key],
    });
    if (r.rows.length === 0) {
      editionOlKey = localExt.open_library_key;
    } else {
      const seed = localExt.isbn_13 ?? localExt.isbn_10 ?? randomUUID();
      editionOlKey = `synthetic:isbn:${seed}`;
    }
  } else {
    const seed = localExt.isbn_13 ?? localExt.isbn_10 ?? randomUUID();
    editionOlKey = `synthetic:isbn:${seed}`;
  }

  // Parse OL cover_id from cover_image_url if it's an OL URL
  let coverId: number | null = null;
  if (localExt.cover_image_url) {
    const match = localExt.cover_image_url.match(/\/b\/id\/(\d+)-/);
    if (match) coverId = parseInt(match[1], 10);
  }

  const publishersJson = localExt.publisher ? JSON.stringify([localExt.publisher]) : null;
  const editionId = randomUUID();

  await sleep(PAUSE_MS);
  try {
    await turso.execute({
      sql: `INSERT INTO editions
              (id, open_library_key, book_id, title, publish_date, publishers,
               isbn_13, isbn_10, pages, cover_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        editionId,
        editionOlKey,
        tursoBookId,
        localExt.title,
        localExt.publication_date,
        publishersJson,
        localExt.isbn_13,
        localExt.isbn_10,
        localExt.pages,
        coverId,
      ],
    });
    return true;
  } catch {
    // Edition already exists, or another conflict. Not fatal — the rest of
    // the patch still landed; we just couldn't preserve this metadata.
    return false;
  }
}

async function patchPair(
  pair: Pair,
  liveAuthorIds: Set<string>,
  liveGenreIds: Set<string>,
  liveSeriesIds: Set<string>,
): Promise<{ ratings: number; genres: number; authors: number; series: number; coverPreserved: boolean; editionCreated: boolean }> {
  // 1. Patch books row enrichment fields. If the UPDATE hits a UNIQUE
  //    constraint (open_library_key, isbn_13, isbn_10, asin all have unique
  //    indexes) it means ANOTHER Turso book is already using that identifier
  //    — a three-way collision. Retry without the unique-indexed fields so
  //    the rest of the enrichment (cover, description, ratings) still lands.
  const localBook = localDb
    .prepare(`SELECT ${BOOK_FIELDS.join(", ")} FROM books WHERE id = ?`)
    .get(pair.local.id) as Record<string, unknown> | undefined;
  if (!localBook) throw new Error(`local book missing: ${pair.local.id}`);

  // Peek at Turso's current cover state so we never overwrite a user-set cover.
  // Rule: if Turso already has a cover_image_url OR its cover_source is 'manual',
  // we treat the live cover as authoritative and exclude cover_* from the UPDATE.
  await sleep(PAUSE_MS);
  const tursoCoverRes = await turso.execute({
    sql: `SELECT cover_image_url, cover_source, cover_verified FROM books WHERE id = ?`,
    args: [pair.turso.id],
  });
  const tursoCover = tursoCoverRes.rows[0] as
    | { cover_image_url: string | null; cover_source: string | null; cover_verified: number | null }
    | undefined;
  const preserveCover =
    !!tursoCover &&
    ((tursoCover.cover_image_url && tursoCover.cover_image_url !== "") ||
      tursoCover.cover_source === "manual");
  const COVER_FIELDS = new Set(["cover_image_url", "cover_source", "cover_verified"]);

  const UNIQUE_FIELDS = new Set(["open_library_key", "isbn_13", "isbn_10", "asin"]);
  async function tryUpdate(excludeUnique: boolean) {
    const setCols = BOOK_FIELDS.filter((c) => {
      if (localBook![c] === undefined) return false;
      if (excludeUnique && UNIQUE_FIELDS.has(c)) return false;
      if (preserveCover && COVER_FIELDS.has(c)) return false;
      return true;
    });
    if (setCols.length === 0) return;
    const setSql = setCols.map((c) => `${c} = ?`).join(", ");
    const args = [...setCols.map((c) => localBook![c] as any), new Date().toISOString(), pair.turso.id];
    await sleep(PAUSE_MS);
    await turso.execute({
      sql: `UPDATE books SET ${setSql}, updated_at = ? WHERE id = ?`,
      args,
    });
  }
  // hadUniqueConflict is true when we had to fall back to tryUpdate(true).
  // When that happens, local's isbn_13/isbn_10/asin/open_library_key didn't
  // make it onto the canonical books row — but they're real edition data we
  // can still preserve by creating a row in `editions` pointing at the
  // canonical book id.
  let hadUniqueConflict = false;
  try {
    await tryUpdate(false);
  } catch (e: any) {
    if (/UNIQUE constraint/i.test(e?.message ?? "")) {
      hadUniqueConflict = true;
      await tryUpdate(true);
    } else {
      throw e;
    }
  }
  let editionCreated = false;
  if (hadUniqueConflict) {
    editionCreated = await maybeCreateEditionForLocalSide(pair.local.id, pair.turso.id);
  }

  // 2. Replace book_category_ratings
  await sleep(PAUSE_MS);
  await turso.execute({ sql: `DELETE FROM book_category_ratings WHERE book_id = ?`, args: [pair.turso.id] });
  const ratings = localDb
    .prepare(`SELECT category_id, intensity, notes, evidence_level, updated_by_user_id FROM book_category_ratings WHERE book_id = ?`)
    .all(pair.local.id) as any[];
  let ratingCount = 0;
  for (const r of ratings) {
    try {
      await sleep(PAUSE_MS);
      await turso.execute({
        sql: `INSERT INTO book_category_ratings (id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [randomUUID(), pair.turso.id, r.category_id, r.intensity, r.notes, r.evidence_level, r.updated_by_user_id],
      });
      ratingCount++;
    } catch { /* skip bad row */ }
  }

  // 3. INSERT OR IGNORE book_genres (filtered to live genres)
  const genres = localDb.prepare(`SELECT genre_id FROM book_genres WHERE book_id = ?`).all(pair.local.id) as any[];
  let genreCount = 0;
  for (const g of genres) {
    if (!liveGenreIds.has(g.genre_id)) continue;
    try {
      await sleep(PAUSE_MS);
      const r = await turso.execute({
        sql: `INSERT OR IGNORE INTO book_genres (book_id, genre_id) VALUES (?, ?)`,
        args: [pair.turso.id, g.genre_id],
      });
      genreCount += Number(r.rowsAffected);
    } catch { /* skip */ }
  }

  // 4. INSERT OR IGNORE book_authors (filtered to live authors)
  const authors = localDb.prepare(`SELECT author_id, role FROM book_authors WHERE book_id = ?`).all(pair.local.id) as any[];
  let authorCount = 0;
  for (const a of authors) {
    if (!liveAuthorIds.has(a.author_id)) continue;
    try {
      await sleep(PAUSE_MS);
      const r = await turso.execute({
        sql: `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, ?)`,
        args: [pair.turso.id, a.author_id, a.role ?? "author"],
      });
      authorCount += Number(r.rowsAffected);
    } catch { /* skip */ }
  }

  // 5. INSERT OR IGNORE book_series (filtered to live series)
  const series = localDb.prepare(`SELECT series_id, position_in_series FROM book_series WHERE book_id = ?`).all(pair.local.id) as any[];
  let seriesCount = 0;
  for (const s of series) {
    if (!liveSeriesIds.has(s.series_id)) continue;
    try {
      await sleep(PAUSE_MS);
      const r = await turso.execute({
        sql: `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
        args: [pair.turso.id, s.series_id, s.position_in_series],
      });
      seriesCount += Number(r.rowsAffected);
    } catch { /* skip */ }
  }

  return { ratings: ratingCount, genres: genreCount, authors: authorCount, series: seriesCount, coverPreserved: preserveCover, editionCreated };
}

async function main() {
  // Initialize Turso client through the project's standard guard so we get
  // the longRunning watchdog exemption. Without longRunning:true the launchd
  // watchdog kills any tsx script under tbra/ older than 60 min — which is
  // exactly what happened on 2026-05-04 (run died at chunk 129/438).
  // 8h ceiling is 1.5x the April benchmark; comfortable headroom.
  const guard = await createGuardedTurso({
    name: "fix-slug-collisions",
    maxRuntimeMs: 8 * 60 * 60 * 1000,
    queryTimeoutMs: 60_000,
    longRunning: true,
  });
  turso = guard.remote;

  const manifestPath = resolveManifest();
  console.log(`=== fix-slug-collisions.ts ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Manifest: ${manifestPath}\n`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pairs: Pair[] = manifest.pairs;
  const actionable = pairs.slice(0, LIMIT);
  console.log(`Total pairs: ${pairs.length}`);
  console.log(`Will patch: ${actionable.length}`);
  console.log();

  if (!APPLY) {
    console.log("Sample (first 5):");
    for (const p of actionable.slice(0, 5)) {
      console.log(`  "${p.local.title.slice(0, 55)}" — local=${p.local.id.slice(0, 8)} turso=${p.turso.id.slice(0, 8)}`);
    }
    console.log();
    console.log("DRY-RUN complete. Re-run with --apply.");
    localDb.close();
    return;
  }

  // Pre-fetch live ID sets
  console.log("Pre-fetching live Turso id sets...");
  const [liveAuthorIds, liveGenreIds, liveSeriesIds] = await Promise.all([
    getTursoAuthorIdSet(),
    getTursoGenreIdSet(),
    getTursoSeriesIdSet(),
  ]);
  await getTursoBookIdSet(); // warm connection
  console.log(`  authors: ${liveAuthorIds.size.toLocaleString()}, genres: ${liveGenreIds.size.toLocaleString()}, series: ${liveSeriesIds.size.toLocaleString()}\n`);

  console.log(`Pacing: chunk=${CHUNK_SIZE}, pause=${PAUSE_MS}ms between queries, cooldown=${COOLDOWN_SEC}s between chunks.\n`);

  let processed = 0, errors = 0, coversPreserved = 0, editionsCreated = 0;
  const totals = { ratings: 0, genres: 0, authors: 0, series: 0 };
  const start = Date.now();
  for (let chunkStart = 0; chunkStart < actionable.length; chunkStart += CHUNK_SIZE) {
    const chunk = actionable.slice(chunkStart, chunkStart + CHUNK_SIZE);
    const chunkStartTs = Date.now();
    for (const pair of chunk) {
      try {
        const r = await patchPair(pair, liveAuthorIds, liveGenreIds, liveSeriesIds);
        totals.ratings += r.ratings;
        totals.genres += r.genres;
        totals.authors += r.authors;
        totals.series += r.series;
        if (r.coverPreserved) coversPreserved++;
        if (r.editionCreated) editionsCreated++;
        processed++;
      } catch (e: any) {
        errors++;
        console.warn(`  ERROR "${pair.local.title.slice(0, 40)}": ${e?.message?.slice(0, 120)}`);
      }
    }
    const chunkElapsed = ((Date.now() - chunkStartTs) / 1000).toFixed(0);
    const totalElapsed = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`  chunk ${chunkStart + chunk.length}/${actionable.length} done in ${chunkElapsed}s (errors=${errors}, total ${totalElapsed}s)`);

    // Cooldown between chunks — lets the Turso connection pool fully drain
    // before the next burst. Skipped on the last chunk.
    if (chunkStart + CHUNK_SIZE < actionable.length) {
      await sleep(COOLDOWN_SEC * 1000);
    }
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nDone: ${processed} patched, ${errors} errors, ${elapsed}s elapsed`);
  console.log(`Covers preserved (Turso kept its existing cover): ${coversPreserved}/${processed}`);
  console.log(`Editions created (UNIQUE-conflict on identifier → preserved as edition): ${editionsCreated}/${processed}`);
  console.log(`Inserted: ${totals.ratings} ratings, ${totals.genres} genres, ${totals.authors} authors, ${totals.series} series`);
  // Note: the Turso client is closed by turso-guard's beforeExit/exit hooks.
  // The Proxy that wraps `remote` doesn't forward `.close()` correctly, so
  // calling `turso.close()` here would throw. The explicit `process.exit(0)`
  // below fires the "exit" event which the guard's cleanup is bound to.
  localDb.close();
}

main()
  .then(() => {
    // Explicit exit — turso-guard's wall-clock deadline (a non-unref'd
    // setTimeout) keeps the event loop alive after natural completion. Without
    // this exit(0), the script "finishes" but the process lingers, holding
    // open Turso connections until the deadline fires (8h here) or something
    // kills it. See the 2026-05-05 outage incident.
    process.exit(0);
  })
  .catch((e) => {
    console.error("FATAL", e);
    process.exit(1);
  });
