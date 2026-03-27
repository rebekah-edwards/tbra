import { NextResponse } from "next/server";
import { db } from "@/db";
import { series, bookSeries, books, bookAuthors, authors, userBookState } from "@/db/schema";
import { eq, sql, and, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

/**
 * Compute Levenshtein edit distance between two strings.
 */
function editDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  let curr = new Array(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const queryLower = q.toLowerCase();
  const prefix = queryLower.slice(0, 2);
  const useFuzzy = queryLower.length >= 3;

  // Fetch broader candidate set for fuzzy matching
  const candidates = await db
    .select({
      id: series.id,
      name: series.name,
      bookCount: sql<number>`count(${bookSeries.bookId})`,
    })
    .from(series)
    .leftJoin(bookSeries, eq(bookSeries.seriesId, series.id))
    .where(
      useFuzzy
        ? sql`LOWER(${series.name}) LIKE ${`%${prefix}%`}`
        : sql`LOWER(${series.name}) LIKE ${`%${queryLower}%`}`
    )
    .groupBy(series.id)
    .limit(useFuzzy ? 30 : 10);

  // Score each candidate
  type ScoredSeries = (typeof candidates)[number] & { matchScore: number };
  const scored: ScoredSeries[] = [];

  for (const s of candidates) {
    const nameLower = s.name.toLowerCase();
    const isSubstring = nameLower.includes(queryLower);

    if (useFuzzy && !isSubstring) {
      const nameWords = nameLower.split(/\s+/);
      const queryWords = queryLower.split(/\s+/);

      let matchedWords = 0;
      let totalDistance = 0;

      for (const qWord of queryWords) {
        let bestDist = qWord.length;
        for (const nWord of nameWords) {
          const dist = editDistance(qWord, nWord.slice(0, qWord.length + 2));
          bestDist = Math.min(bestDist, dist);
        }
        const threshold = Math.max(1, Math.floor(qWord.length * 0.35));
        if (bestDist <= threshold) {
          matchedWords++;
          totalDistance += bestDist;
        }
      }

      if (matchedWords < Math.ceil(queryWords.length * 0.7)) continue;
      scored.push({ ...s, matchScore: totalDistance + 10 });
    } else if (isSubstring) {
      const startsWithBonus = nameLower.startsWith(queryLower) ? -5 : 0;
      scored.push({ ...s, matchScore: startsWithBonus });
    }
  }

  scored.sort((a, b) => {
    if (a.matchScore !== b.matchScore) return a.matchScore - b.matchScore;
    return b.bookCount - a.bookCount;
  });

  const seriesResults = scored.slice(0, 3);

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
        id: s.id,
        name: s.name,
        bookCount: s.bookCount,
        books: booksWithAuthors,
      };
    })
  );

  return NextResponse.json(enriched);
}
