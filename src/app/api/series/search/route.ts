import { NextResponse } from "next/server";
import { db } from "@/db";
import { series, bookSeries, books, bookAuthors, authors, userBookState } from "@/db/schema";
import { like, eq, sql, and, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  // Find matching series
  const seriesResults = await db
    .select({
      id: series.id,
      name: series.name,
      bookCount: sql<number>`count(${bookSeries.bookId})`,
    })
    .from(series)
    .leftJoin(bookSeries, eq(bookSeries.seriesId, series.id))
    .where(like(series.name, `%${q}%`))
    .groupBy(series.id)
    .limit(3);

  if (seriesResults.length === 0) {
    return NextResponse.json([]);
  }

  // Get current user for reading state
  const user = await getCurrentUser();
  const userId = user?.userId ?? null;

  // For each matched series, fetch its books (core only — integer positions, no box sets)
  const enriched = await Promise.all(
    seriesResults.map(async (s) => {
      const seriesBooks = await db
        .select({
          id: books.id,
          title: books.title,
          coverImageUrl: books.coverImageUrl,
          position: bookSeries.positionInSeries,
          publicationYear: books.publicationYear,
          openLibraryKey: books.openLibraryKey,
          isBoxSet: books.isBoxSet,
        })
        .from(bookSeries)
        .innerJoin(books, eq(books.id, bookSeries.bookId))
        .where(
          and(
            eq(bookSeries.seriesId, s.id),
            isNotNull(bookSeries.positionInSeries)
          )
        )
        .orderBy(bookSeries.positionInSeries);

      // Filter to core books (integer positions, not box sets)
      const coreBooks = seriesBooks.filter(
        (b) =>
          b.position != null &&
          Number.isInteger(b.position) &&
          !b.isBoxSet
      );

      // Get authors for each book
      const booksWithAuthors = await Promise.all(
        coreBooks.map(async (book) => {
          const bookAuthorRows = await db
            .select({ name: authors.name })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(eq(bookAuthors.bookId, book.id));

          // Get reading state if logged in
          let currentState: string | null = null;
          let ownedFormats: string[] = [];
          if (userId) {
            const stateRow = await db
              .select({ state: userBookState.state, ownedFormats: userBookState.ownedFormats })
              .from(userBookState)
              .where(
                and(
                  eq(userBookState.userId, userId),
                  eq(userBookState.bookId, book.id)
                )
              )
              .limit(1);
            if (stateRow.length > 0) {
              currentState = stateRow[0].state;
              ownedFormats = stateRow[0].ownedFormats
                ? JSON.parse(stateRow[0].ownedFormats)
                : [];
            }
          }

          return {
            id: book.id,
            title: book.title,
            coverImageUrl: book.coverImageUrl,
            position: book.position,
            publicationYear: book.publicationYear,
            authors: bookAuthorRows.map((a) => a.name),
            currentState,
            ownedFormats,
          };
        })
      );

      return {
        ...s,
        books: booksWithAuthors,
      };
    })
  );

  return NextResponse.json(enriched);
}
