import { NextRequest, NextResponse } from "next/server";
import { isJunkTitle } from "@/lib/openlibrary";
import { db } from "@/db";
import { books, bookAuthors, authors } from "@/db/schema";
import { like, eq, sql, and } from "drizzle-orm";
import { isBoxSetTitle } from "@/lib/queries/books";

/**
 * Local-first book search.
 *
 * This endpoint is intentionally LOCAL-ONLY for speed. Previously it called
 * OpenLibrary's search API, which cascaded up to 11 sequential HTTP requests
 * and took 5-30 seconds on slow/flaky OL days. We now serve from the local
 * DB only (~20-80ms) and let the client optionally request external results
 * from /api/search/external (ISBNdb-backed, quota-capped) as a fallback.
 *
 * The route name is preserved so existing callers don't need to change.
 */

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const trimmed = q.trim();

  // Show box sets only when the user explicitly searches for them
  const BOX_SET_QUERY = /\b(set|box\s*set|collection|boxed)\b/i;
  const showBoxSets = BOX_SET_QUERY.test(trimmed);

  const localResults = await searchLocalBooks(trimmed, showBoxSets);
  return NextResponse.json(localResults);
}

/**
 * Search local DB for books matching the query.
 * Searches by title AND by author name, batches the author lookup for
 * performance, and limits to 20 results.
 */
async function searchLocalBooks(query: string, showBoxSets = false) {
  const lowerQuery = query.toLowerCase();
  const likePattern = `%${lowerQuery}%`;

  // Search by title (case-insensitive) OR author name (case-insensitive)
  // Single query with a subquery for author match to avoid N+1.
  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      slug: books.slug,
      openLibraryKey: books.openLibraryKey,
      coverImageUrl: books.coverImageUrl,
      publicationYear: books.publicationYear,
      pages: books.pages,
      isbn13: books.isbn13,
      isbn10: books.isbn10,
    })
    .from(books)
    .where(
      and(
        eq(books.visibility, "public"),
        sql`(
          LOWER(${books.title}) LIKE ${likePattern}
          OR ${books.id} IN (
            SELECT ba.book_id FROM book_authors ba
            INNER JOIN authors a ON a.id = ba.author_id
            WHERE LOWER(a.name) LIKE ${likePattern}
          )
        )`,
      )
    )
    .limit(20)
    .all();

  if (rows.length === 0) return [];

  // Batch fetch authors for all matched books in a single query
  const bookIds = rows.map((r) => r.id);
  const authorRows = await db
    .select({
      bookId: bookAuthors.bookId,
      name: authors.name,
      olKey: authors.openLibraryKey,
    })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(sql`${bookAuthors.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
    .all();

  const authorsByBook = new Map<string, { name: string; olKey: string | null }[]>();
  for (const row of authorRows) {
    const list = authorsByBook.get(row.bookId) ?? [];
    list.push({ name: row.name, olKey: row.olKey ?? null });
    authorsByBook.set(row.bookId, list);
  }

  // Rank: prefer books whose TITLE contains the query over author-only matches
  const titleMatches: typeof rows = [];
  const authorMatches: typeof rows = [];
  for (const row of rows) {
    if (row.title.toLowerCase().includes(lowerQuery)) {
      titleMatches.push(row);
    } else {
      authorMatches.push(row);
    }
  }
  const ordered = [...titleMatches, ...authorMatches];

  // Convert to OLSearchResult-compatible shape, filtering out junk/box sets
  const results = [];
  for (const row of ordered) {
    if (isJunkTitle(row.title) || (!showBoxSets && isBoxSetTitle(row.title))) continue;
    const bookAuthorRows = authorsByBook.get(row.id) ?? [];

    // Extract cover ID from URL if present
    let coverId: number | null = null;
    if (row.coverImageUrl) {
      const match = row.coverImageUrl.match(/\/b\/id\/(\d+)-/);
      if (match) coverId = parseInt(match[1], 10);
    }

    results.push({
      key: row.openLibraryKey ?? `local:${row.id}`,
      title: row.title,
      author_name: bookAuthorRows.map((a) => a.name),
      author_key: bookAuthorRows.map((a) => a.olKey).filter(Boolean) as string[],
      first_publish_year: row.publicationYear ?? undefined,
      cover_i: coverId,
      isbn: [row.isbn13, row.isbn10].filter(Boolean) as string[],
      number_of_pages_median: row.pages ?? undefined,
      // Flags for the frontend to know this is a local result
      _localBookId: row.id,
      _localSlug: row.slug,
      _localCoverUrl: row.coverImageUrl,
    });
  }

  return results;
}
