import { NextResponse } from "next/server";
import { db } from "@/db";
import { series, bookSeries, books, bookAuthors, authors, userBookState } from "@/db/schema";
import { eq, sql, and, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { scoreFuzzyMatches } from "@/lib/search/fuzzy";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const queryLower = q.toLowerCase();
  const useFuzzy = queryLower.length >= 4;

  // Always try exact substring first — catches most cases instantly
  const candidates = await db
    .select({
      id: series.id,
      name: series.name,
      bookCount: sql<number>`count(${bookSeries.bookId})`,
    })
    .from(series)
    .leftJoin(bookSeries, eq(bookSeries.seriesId, series.id))
    .where(sql`LOWER(${series.name}) LIKE ${`%${queryLower}%`}`)
    .groupBy(series.id)
    .limit(10);

  // If too few exact matches and query is long enough, broaden with prefix for fuzzy
  let fuzzyCandidates: typeof candidates = [];
  if (useFuzzy && candidates.length < 3) {
    const prefix = queryLower.slice(0, 3);
    const exactIds = new Set(candidates.map((c) => c.id));
    fuzzyCandidates = (await db
      .select({
        id: series.id,
        name: series.name,
        bookCount: sql<number>`count(${bookSeries.bookId})`,
      })
      .from(series)
      .leftJoin(bookSeries, eq(bookSeries.seriesId, series.id))
      .where(sql`LOWER(${series.name}) LIKE ${`%${prefix}%`}`)
      .groupBy(series.id)
      .limit(20)
    ).filter((c) => !exactIds.has(c.id));
  }

  const allCandidates = [...candidates, ...fuzzyCandidates];

  // Score and rank using shared fuzzy matcher
  const seriesResults = scoreFuzzyMatches(allCandidates, q, 3);

  if (seriesResults.length === 0) {
    return NextResponse.json([]);
  }

  const seriesIds = seriesResults.map((s) => s.id);

  // Batch: fetch ALL books for ALL matched series in one query
  const allSeriesBooks = await db
    .select({
      seriesId: bookSeries.seriesId,
      bookId: books.id,
      slug: books.slug,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      position: bookSeries.positionInSeries,
      publicationYear: books.publicationYear,
      isBoxSet: books.isBoxSet,
    })
    .from(bookSeries)
    .innerJoin(books, eq(books.id, bookSeries.bookId))
    .where(
      and(
        sql`${bookSeries.seriesId} IN (${sql.join(seriesIds.map((id) => sql`${id}`), sql`, `)})`,
        isNotNull(bookSeries.positionInSeries)
      )
    )
    .orderBy(bookSeries.positionInSeries);

  // Filter to core books (integer positions, not box sets)
  const coreBooks = allSeriesBooks.filter(
    (b) => b.position != null && Number.isInteger(b.position) && !b.isBoxSet
  );
  const allBookIds = coreBooks.map((b) => b.bookId);

  // Batch: fetch ALL authors for ALL books in one query
  const [allAuthors, user] = await Promise.all([
    allBookIds.length > 0
      ? db
          .select({ bookId: bookAuthors.bookId, name: authors.name })
          .from(bookAuthors)
          .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
          .where(sql`${bookAuthors.bookId} IN (${sql.join(allBookIds.map((id) => sql`${id}`), sql`, `)})`)
          .all()
      : Promise.resolve([]),
    getCurrentUser(),
  ]);

  const authorsByBook = new Map<string, string[]>();
  for (const row of allAuthors) {
    const existing = authorsByBook.get(row.bookId) ?? [];
    existing.push(row.name);
    authorsByBook.set(row.bookId, existing);
  }

  // Batch: fetch ALL reading states in one query
  const userId = user?.userId ?? null;
  const stateMap = new Map<string, { state: string | null; ownedFormats: string[] }>();
  if (userId && allBookIds.length > 0) {
    const stateRows = await db
      .select({
        bookId: userBookState.bookId,
        state: userBookState.state,
        ownedFormats: userBookState.ownedFormats,
      })
      .from(userBookState)
      .where(
        and(
          eq(userBookState.userId, userId),
          sql`${userBookState.bookId} IN (${sql.join(allBookIds.map((id) => sql`${id}`), sql`, `)})`
        )
      )
      .all();
    for (const r of stateRows) {
      stateMap.set(r.bookId, {
        state: r.state,
        ownedFormats: r.ownedFormats ? JSON.parse(r.ownedFormats) : [],
      });
    }
  }

  // Group books by series and assemble response
  const enriched = seriesResults.map((s) => {
    const seriesCoreBooks = coreBooks
      .filter((b) => b.seriesId === s.id)
      .map((book) => {
        const stateInfo = stateMap.get(book.bookId);
        return {
          id: book.bookId,
          slug: book.slug,
          title: book.title,
          coverImageUrl: book.coverImageUrl,
          position: book.position,
          publicationYear: book.publicationYear,
          authors: authorsByBook.get(book.bookId) ?? [],
          currentState: stateInfo?.state ?? null,
          ownedFormats: stateInfo?.ownedFormats ?? [],
        };
      });

    return {
      id: s.id,
      name: s.name,
      bookCount: s.bookCount,
      books: seriesCoreBooks,
    };
  });

  return NextResponse.json(enriched);
}
