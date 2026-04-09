import { db } from "@/db";
import { books, bookAuthors, authors, bookSeries, series } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Update the FTS5 search index for a single book. Called after any operation
 * that changes a book's title, authors, or series membership (enrichment,
 * manual add, import, etc).
 *
 * Uses DELETE + INSERT (not UPDATE) because FTS5 virtual tables don't
 * support UPDATE in the usual sense. Safe to call even if the book doesn't
 * exist in the index yet (DELETE is a no-op, INSERT creates the row).
 */
export async function updateSearchIndex(bookId: string): Promise<void> {
  try {
    // Remove old entry
    await db.run(sql`DELETE FROM search_index WHERE book_id = ${bookId}`);

    // Fetch current data
    const book = await db
      .select({ id: books.id, title: books.title, visibility: books.visibility, isBoxSet: books.isBoxSet })
      .from(books)
      .where(eq(books.id, bookId))
      .get();

    if (!book || book.visibility !== "public" || book.isBoxSet) return;

    // Get authors
    const authorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, bookId))
      .all();
    const authorNames = authorRows.map((r) => r.name).join(" ");

    // Get series
    const seriesRows = await db
      .select({ name: series.name })
      .from(bookSeries)
      .innerJoin(series, eq(bookSeries.seriesId, series.id))
      .where(eq(bookSeries.bookId, bookId))
      .all();
    const seriesName = seriesRows.map((r) => r.name).join(" ");

    // Insert into FTS index
    await db.run(
      sql`INSERT INTO search_index (book_id, title, author_names, series_name)
          VALUES (${bookId}, ${book.title}, ${authorNames}, ${seriesName})`,
    );
  } catch (err) {
    // FTS index updates are best-effort — don't let a failure here break
    // the parent operation (enrichment, import, etc). The nightly rebuild
    // catches any drift.
    console.warn(`[search-index] Failed to update index for ${bookId}:`, err);
  }
}

/**
 * Remove a book from the search index (e.g. when hidden or deleted).
 */
export async function removeFromSearchIndex(bookId: string): Promise<void> {
  try {
    await db.run(sql`DELETE FROM search_index WHERE book_id = ${bookId}`);
  } catch (err) {
    console.warn(`[search-index] Failed to remove ${bookId} from index:`, err);
  }
}

/**
 * Search books using FTS5 full-text search. Returns book IDs ranked by
 * relevance (BM25). Supports prefix matching for as-you-type search
 * (append * to query or last word).
 *
 * Example queries:
 *   "piranesi"        → exact match
 *   "piran*"          → prefix match
 *   "name wind"       → multi-word (AND, any order)
 *   "harry pot*"      → prefix on last word
 *   "rothfuss"        → matches author name column
 *   "kingkiller"      → matches series name column
 */
export async function searchBooksFTS(
  query: string,
  limit = 20,
): Promise<{ bookId: string; rank: number }[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  // Build FTS5 query: split into words, append * to last word for prefix matching
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // Append * for prefix matching on the last word (as-you-type behavior)
  const lastWord = words[words.length - 1];
  if (!lastWord.endsWith("*") && !lastWord.endsWith('"')) {
    words[words.length - 1] = lastWord + "*";
  }

  const ftsQuery = words.join(" ");

  try {
    const rows = await db.all<{ book_id: string; rank: number }>(
      sql`SELECT book_id, rank FROM search_index
          WHERE search_index MATCH ${ftsQuery}
          ORDER BY rank
          LIMIT ${limit}`,
    );
    return rows.map((r) => ({ bookId: r.book_id, rank: r.rank }));
  } catch (err) {
    // FTS5 queries can fail on malformed input (unbalanced quotes, special
    // chars). Fall back to empty rather than crashing.
    console.warn(`[search-index] FTS query failed for "${ftsQuery}":`, err);
    return [];
  }
}
