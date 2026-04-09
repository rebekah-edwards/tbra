import { NextRequest, NextResponse } from "next/server";
import { isJunkTitle } from "@/lib/openlibrary";
import { db } from "@/db";
import { books, bookAuthors, authors } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { isBoxSetTitle } from "@/lib/queries/books";
import { searchBooksFTS } from "@/lib/search/search-index";

/**
 * Local-first book search, now powered by FTS5 full-text search.
 *
 * Previous versions used LIKE '%query%' which had no relevance ranking,
 * no fuzzy matching, and no word-reordering support. FTS5 provides all
 * three plus prefix matching (as-you-type) in ~3ms for 46K books.
 *
 * The route name is preserved so existing callers don't need to change.
 */

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const trimmed = q.trim()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // Show box sets only when the user explicitly searches for them
  const BOX_SET_QUERY = /\b(set|box\s*set|collection|boxed)\b/i;
  const showBoxSets = BOX_SET_QUERY.test(trimmed);

  // FTS5 full-text search — returns book IDs ranked by BM25 relevance
  const ftsResults = await searchBooksFTS(trimmed, 30);
  if (ftsResults.length === 0) return NextResponse.json([]);

  const bookIds = ftsResults.map((r) => r.bookId);

  // Batch fetch book data + authors in parallel
  const [bookRows, authorRows] = await Promise.all([
    db
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
      .where(sql`${books.id} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
      .all(),
    db
      .select({
        bookId: bookAuthors.bookId,
        name: authors.name,
        olKey: authors.openLibraryKey,
      })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(sql`${bookAuthors.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
      .all(),
  ]);

  const bookMap = new Map(bookRows.map((b) => [b.id, b]));
  const authorsByBook = new Map<string, { name: string; olKey: string | null }[]>();
  for (const row of authorRows) {
    const list = authorsByBook.get(row.bookId) ?? [];
    list.push({ name: row.name, olKey: row.olKey ?? null });
    authorsByBook.set(row.bookId, list);
  }

  // Build results in FTS rank order (most relevant first), filtering junk/box sets
  const results = [];
  for (const ftsRow of ftsResults) {
    const row = bookMap.get(ftsRow.bookId);
    if (!row) continue;
    if (isJunkTitle(row.title) || (!showBoxSets && isBoxSetTitle(row.title))) continue;

    const bookAuthorList = authorsByBook.get(row.id) ?? [];

    let coverId: number | null = null;
    if (row.coverImageUrl) {
      const match = row.coverImageUrl.match(/\/b\/id\/(\d+)-/);
      if (match) coverId = parseInt(match[1], 10);
    }

    results.push({
      key: row.openLibraryKey ?? `local:${row.id}`,
      title: row.title,
      author_name: bookAuthorList.map((a) => a.name),
      author_key: bookAuthorList.map((a) => a.olKey).filter(Boolean) as string[],
      first_publish_year: row.publicationYear ?? undefined,
      cover_i: coverId,
      isbn: [row.isbn13, row.isbn10].filter(Boolean) as string[],
      number_of_pages_median: row.pages ?? undefined,
      _localBookId: row.id,
      _localSlug: row.slug,
      _localCoverUrl: row.coverImageUrl,
    });

    if (results.length >= 20) break;
  }

  return NextResponse.json(results);
}
