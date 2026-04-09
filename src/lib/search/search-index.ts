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
 * Search books using FTS5 full-text search when available, falling back
 * to optimized LIKE queries when it's not (e.g. on Turso where FTS5
 * tables are too large for the hosted DB).
 *
 * FTS5 features (local only): relevance ranking, prefix matching, word
 * reordering, stemming.
 *
 * LIKE fallback (Turso): substring match on title + author name via
 * subquery, ordered by title match quality. Still fast (~50ms for 46K).
 */
export async function searchBooksFTS(
  query: string,
  limit = 20,
): Promise<{ bookId: string; rank: number }[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  // Try FTS5 first
  try {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lastWord = words[words.length - 1];
    if (!lastWord.endsWith("*") && !lastWord.endsWith('"')) {
      words[words.length - 1] = lastWord + "*";
    }
    const ftsQuery = words.join(" ");

    const rows = await db.all<{ book_id: string; rank: number }>(
      sql`SELECT book_id, rank FROM search_index
          WHERE search_index MATCH ${ftsQuery}
          ORDER BY rank
          LIMIT ${limit}`,
    );
    return rows.map((r) => ({ bookId: r.book_id, rank: r.rank }));
  } catch {
    // FTS5 table doesn't exist (Turso) or query is malformed — fall back to LIKE
  }

  // LIKE fallback — works on Turso where FTS5 table was dropped due to
  // 213MB size overhead that degraded all other queries.
  const likePattern = `%${trimmed.toLowerCase()}%`;
  try {
    const rows = await db.all<{ id: string }>(sql`
      SELECT id FROM books
      WHERE visibility = 'public' AND is_box_set = 0
        AND (
          LOWER(title) LIKE ${likePattern}
          OR id IN (
            SELECT ba.book_id FROM book_authors ba
            INNER JOIN authors a ON a.id = ba.author_id
            WHERE LOWER(a.name) LIKE ${likePattern}
          )
        )
      LIMIT ${limit}
    `);
    // No relevance ranking for LIKE — assign synthetic rank based on position
    return rows.map((r, i) => ({ bookId: r.id, rank: -(limit - i) }));
  } catch (err) {
    console.warn(`[search-index] LIKE fallback failed:`, err);
    return [];
  }
}
