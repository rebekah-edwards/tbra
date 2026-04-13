import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { books, bookAuthors, authors, series, bookSeries, userBookState } from "@/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { searchBooksFTS } from "@/lib/search/search-index";

/**
 * Unified search endpoint for the nav search bar.
 * Returns books (via FTS5), series (LIKE), and authors (LIKE).
 * User search removed — belongs in a dedicated "Find People" section.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ books: [], series: [], authors: [] });
  }

  const trimmed = q.trim()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // Run all searches in parallel
  const [ftsResults, seriesResults, authorResults, user] = await Promise.all([
    searchBooksFTS(trimmed, 20),
    searchSeries(trimmed.toLowerCase()),
    searchAuthors(trimmed.toLowerCase()),
    getCurrentUser(),
  ]);

  // Hydrate FTS results with book data + authors in batch
  let bookResults: {
    id: string;
    slug: string | null;
    title: string;
    coverImageUrl: string | null;
    publicationYear: number | null;
    authors: string[];
    state: string | null;
  }[] = [];

  if (ftsResults.length > 0) {
    const bookIds = ftsResults.map((r) => r.bookId);

    // Batch fetch book data
    const bookRows = await db
      .select({
        id: books.id,
        slug: books.slug,
        title: books.title,
        coverImageUrl: books.coverImageUrl,
        publicationYear: books.publicationYear,
      })
      .from(books)
      .where(sql`${books.id} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
      .all();

    const bookMap = new Map(bookRows.map((b) => [b.id, b]));

    // Batch fetch authors
    const authorRows = await db
      .select({ bookId: bookAuthors.bookId, name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(sql`${bookAuthors.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
      .all();

    const authorsByBook = new Map<string, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    // Dedup by normalized title + primary author, preserving FTS rank order
    const seen = new Set<string>();
    for (const ftsRow of ftsResults) {
      const book = bookMap.get(ftsRow.bookId);
      if (!book) continue;
      const authorNames = authorsByBook.get(book.id) ?? [];
      const normTitle = book.title.toLowerCase().replace(/\s*\(.*\)$/, "").replace(/[^a-z0-9]/g, "");
      const primaryAuthor = (authorNames[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
      const key = `${normTitle}::${primaryAuthor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bookResults.push({
        ...book,
        authors: authorNames,
        state: null,
      });
    }

    // Enrich with reading states if logged in
    if (user && bookResults.length > 0) {
      const ids = bookResults.map((b) => b.id);
      const stateRows = await db
        .select({ bookId: userBookState.bookId, state: userBookState.state })
        .from(userBookState)
        .where(and(
          eq(userBookState.userId, user.userId),
          sql`${userBookState.bookId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
        ))
        .all();
      const stateMap = new Map(stateRows.map((r) => [r.bookId, r.state]));
      for (const book of bookResults) {
        book.state = stateMap.get(book.id) ?? null;
      }
    }

    bookResults = bookResults.slice(0, 8);
  }

  return NextResponse.json({
    books: bookResults,
    series: seriesResults,
    authors: authorResults,
  });
}

// ─── Series search — Meilisearch with DB fallback ───
async function searchSeries(query: string) {
  let rows: { id: string; name: string; slug: string | null; bookCount: number }[];

  if (process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_SEARCH_KEY) {
    try {
      const { searchSeriesMeilisearch } = await import("@/lib/search/meilisearch");
      const meiliResults = await searchSeriesMeilisearch(query, 3);
      // Meilisearch doesn't have slug — fetch from DB
      if (meiliResults.length > 0) {
        const ids = meiliResults.map((r) => r.id);
        const dbRows = await db
          .select({ id: series.id, slug: series.slug })
          .from(series)
          .where(sql`${series.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
        const slugMap = new Map(dbRows.map((r) => [r.id, r.slug]));
        rows = meiliResults.map((r) => ({ ...r, slug: slugMap.get(r.id) ?? null }));
      } else {
        rows = [];
      }
    } catch {
      rows = await searchSeriesDB(query);
    }
  } else {
    rows = await searchSeriesDB(query);
  }

  if (rows.length === 0) return [];

  // Batch fetch all books for matched series in ONE query (fixes N+1)
  const seriesIds = rows.map((r) => r.id);
  const allSeriesBooks = await db
    .select({
      seriesId: bookSeries.seriesId,
      id: books.id,
      slug: books.slug,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      position: bookSeries.positionInSeries,
      isBoxSet: books.isBoxSet,
    })
    .from(bookSeries)
    .innerJoin(books, eq(bookSeries.bookId, books.id))
    .where(sql`${bookSeries.seriesId} IN (${sql.join(seriesIds.map((id) => sql`${id}`), sql`, `)})`)
    .orderBy(bookSeries.positionInSeries);

  return rows.map((row) => {
    // Show core books only (integer positions, no box sets) as thumbnails
    const core = allSeriesBooks.filter((b) =>
      b.seriesId === row.id && b.position != null && Number.isInteger(b.position) && !b.isBoxSet
    );
    return { ...row, books: core.slice(0, 7) };
  });
}

async function searchSeriesDB(query: string) {
  return db
    .select({
      id: series.id,
      name: series.name,
      slug: series.slug,
      bookCount: sql<number>`count(${bookSeries.bookId})`,
    })
    .from(series)
    .leftJoin(bookSeries, eq(bookSeries.seriesId, series.id))
    .where(sql`LOWER(${series.name}) LIKE ${`%${query}%`}`)
    .groupBy(series.id)
    .orderBy(sql`count(${bookSeries.bookId}) DESC`)
    .limit(3);
}

// ─── Author search — Meilisearch with DB fallback ───
async function searchAuthors(query: string) {
  if (process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_SEARCH_KEY) {
    try {
      const { searchAuthorsMeilisearch } = await import("@/lib/search/meilisearch");
      const meiliResults = await searchAuthorsMeilisearch(query, 3);
      if (meiliResults.length > 0) {
        const ids = meiliResults.map((r) => r.id);
        const dbRows = await db
          .select({ id: authors.id, slug: authors.slug })
          .from(authors)
          .where(sql`${authors.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
        const slugMap = new Map(dbRows.map((r) => [r.id, r.slug]));
        return meiliResults.map((r) => ({ ...r, slug: slugMap.get(r.id) ?? null }));
      }
      return [];
    } catch {
      // Fall through to DB
    }
  }
  return db
    .select({
      id: authors.id,
      name: authors.name,
      slug: authors.slug,
      bookCount: sql<number>`count(${bookAuthors.bookId})`,
    })
    .from(authors)
    .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
    .where(sql`LOWER(${authors.name}) LIKE ${`%${query}%`}`)
    .groupBy(authors.id)
    .orderBy(sql`count(${bookAuthors.bookId}) desc`)
    .limit(3);
}
