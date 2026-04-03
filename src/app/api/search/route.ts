import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { books, bookAuthors, authors, series, bookSeries, users, userBookState, bookCategoryRatings } from "@/db/schema";
import { eq, sql, and, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

/**
 * Unified search endpoint — runs books, series, authors, and users
 * searches within a SINGLE serverless function invocation.
 * Eliminates 4 parallel cold starts from the search bar.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ books: [], series: [], authors: [], users: [] });
  }

  const trimmed = q.trim().toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // Run all searches in parallel using the SAME db connection
  const [bookResults, seriesResults, authorResults, userResults, user] = await Promise.all([
    searchBooks(trimmed),
    searchSeries(trimmed),
    searchAuthors(trimmed),
    searchUsers(trimmed),
    getCurrentUser(),
  ]);

  // Enrich books with reading states if logged in
  if (user && bookResults.length > 0) {
    const bookIds = bookResults.map((b) => b.id);
    const stateRows = await db
      .select({ bookId: userBookState.bookId, state: userBookState.state })
      .from(userBookState)
      .where(and(
        eq(userBookState.userId, user.userId),
        sql`${userBookState.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`
      ))
      .all();
    const stateMap = new Map(stateRows.map((r) => [r.bookId, r.state]));
    for (const book of bookResults) {
      book.state = stateMap.get(book.id) ?? null;
    }
  }

  return NextResponse.json({
    books: bookResults,
    series: seriesResults,
    authors: authorResults,
    users: userResults,
  });
}

// ─── Book search (simplified from /api/books/search) ───
async function searchBooks(query: string) {
  const rows = await db
    .select({
      id: books.id,
      slug: books.slug,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      publicationYear: books.publicationYear,
    })
    .from(books)
    .where(and(
      sql`LOWER(${books.title}) LIKE ${`%${query}%`}`,
      eq(books.visibility, "public"),
      eq(books.isBoxSet, false)
    ))
    .limit(20)
    .all();

  // Also search by author name
  let authorMatchRows: typeof rows = [];
  if (query.length >= 3) {
    const titleIds = new Set(rows.map((r) => r.id));
    authorMatchRows = (await db
      .select({
        id: books.id, slug: books.slug, title: books.title,
        coverImageUrl: books.coverImageUrl, publicationYear: books.publicationYear,
      })
      .from(books)
      .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(and(
        sql`LOWER(${authors.name}) LIKE ${`%${query}%`}`,
        eq(books.visibility, "public"),
        eq(books.isBoxSet, false)
      ))
      .orderBy(sql`${books.publicationYear} DESC NULLS LAST`)
      .limit(20)
      .all()
    ).filter((r) => !titleIds.has(r.id));
  }

  const allBooks = [...rows, ...authorMatchRows];
  const bookIds = allBooks.map((r) => r.id);

  // Batch fetch authors
  const allAuthorsData = bookIds.length > 0
    ? await db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(sql`${bookAuthors.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
        .all()
    : [];

  const authorsByBook = new Map<string, string[]>();
  for (const row of allAuthorsData) {
    const existing = authorsByBook.get(row.bookId) ?? [];
    existing.push(row.name);
    authorsByBook.set(row.bookId, existing);
  }

  // Deduplicate by normalized title + author, prefer books with covers
  const seen = new Map<string, typeof allBooks[0] & { authors: string[]; state: string | null }>();
  const results: (typeof allBooks[0] & { authors: string[]; state: string | null })[] = [];

  for (const book of allBooks) {
    const authorNames = authorsByBook.get(book.id) ?? [];
    const normTitle = book.title.toLowerCase().replace(/\s*\(.*\)$/, "").replace(/[^a-z0-9]/g, "");
    const primaryAuthor = (authorNames[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const key = `${normTitle}::${primaryAuthor}`;

    const entry = { ...book, authors: authorNames, state: null as string | null };

    if (seen.has(key)) {
      const existing = seen.get(key)!;
      if (book.coverImageUrl && !existing.coverImageUrl) {
        const idx = results.indexOf(existing);
        if (idx >= 0) results[idx] = entry;
        seen.set(key, entry);
      }
    } else {
      seen.set(key, entry);
      results.push(entry);
    }
  }

  return results.slice(0, 8);
}

// ─── Series search (simplified from /api/series/search) ───
async function searchSeries(query: string) {
  const rows = await db
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

  return rows;
}

// ─── Author search (simplified from /api/authors/search) ───
async function searchAuthors(query: string) {
  const rows = await db
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

  return rows;
}

// ─── User search (simplified) ───
async function searchUsers(query: string) {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(and(
      sql`(LOWER(${users.username}) LIKE ${`%${query}%`} OR LOWER(${users.displayName}) LIKE ${`%${query}%`})`,
      isNotNull(users.username),
      eq(users.isPrivate, false)
    ))
    .limit(5);

  return rows;
}
