import { sql, type SQL } from "drizzle-orm";

/**
 * `idx_books_covered_lite` — a narrow partial index over books with a cover
 * (id, visibility, language, publication_year, is_box_set, is_fiction, pages,
 * created_at, cover_image_url, slug, title). Created 2026-11-25 after /browse
 * and uncached book pages hit Vercel's 300s limit: their queries visited every
 * one of ~75k wide `books` rows (descriptions, summaries), and on Turso each
 * row visit costs ~2ms — 2-3 minutes per query. Read through this index they
 * never touch the wide rows.
 *
 * The planner does not choose it on its own (it prefers the id autoindex /
 * idx_books_visibility), so queries pin it with INDEXED BY — and every such
 * query must keep `cover_image_url IS NOT NULL` in its WHERE, the index's
 * partial condition. INDEXED BY fails outright if the index is missing (a DB
 * that hasn't been migrated), so callers go through withCoveredIndex(), which
 * falls back to the plain query and remembers the miss.
 */
export const COVERED_BOOKS_INDEX = "idx_books_covered_lite";

// When the index was found missing (ms timestamp). Re-checked after 10
// minutes, so creating the index later takes effect without a redeploy.
let missingSince = 0;
const RECHECK_MS = 10 * 60 * 1000;
function isMissing(): boolean {
  if (missingSince && Date.now() - missingSince > RECHECK_MS) missingSince = 0;
  return missingSince > 0;
}

/** `books b INDEXED BY …` (or plain `books b` once the index is known missing). */
export function booksFrom(alias = "b"): SQL {
  const table = alias === "books" ? "books" : `books ${alias}`;
  return isMissing() ? sql.raw(table) : sql.raw(`${table} INDEXED BY ${COVERED_BOOKS_INDEX}`);
}

export async function withCoveredIndex<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    // Drizzle wraps driver errors ("Failed query: …") and keeps the SQLite
    // message on .cause — check the whole chain.
    let text = "";
    for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
      text += " " + String((e as Error)?.message ?? e);
    }
    if (!isMissing() && /no such index/i.test(text)) {
      missingSince = Date.now();
      console.warn(`[db] ${COVERED_BOOKS_INDEX} missing — running without it`);
      return run();
    }
    throw err;
  }
}
