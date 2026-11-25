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

let indexMissing = false;

/** `books b INDEXED BY …` (or plain `books b` once the index is known missing). */
export function booksFrom(alias = "b"): SQL {
  const table = alias === "books" ? "books" : `books ${alias}`;
  return indexMissing ? sql.raw(table) : sql.raw(`${table} INDEXED BY ${COVERED_BOOKS_INDEX}`);
}

export async function withCoveredIndex<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!indexMissing && /no such index/i.test(String((err as Error)?.message ?? err))) {
      indexMissing = true;
      console.warn(`[db] ${COVERED_BOOKS_INDEX} missing — running without it`);
      return run();
    }
    throw err;
  }
}
