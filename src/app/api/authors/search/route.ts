import { NextResponse } from "next/server";
import { db } from "@/db";
import { authors, bookAuthors, books } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { scoreFuzzyMatches } from "@/lib/search/fuzzy";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const queryLower = q.toLowerCase();
  const useFuzzy = queryLower.length >= 4;

  // Always try exact substring first
  const candidates = await db
    .select({
      id: authors.id,
      name: authors.name,
      bookCount: sql<number>`count(${bookAuthors.bookId})`,
    })
    .from(authors)
    .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
    .where(sql`LOWER(${authors.name}) LIKE ${`%${queryLower}%`}`)
    .groupBy(authors.id)
    .orderBy(sql`count(${bookAuthors.bookId}) desc`)
    .limit(10);

  // Broaden with prefix for fuzzy if too few exact matches
  let fuzzyCandidates: typeof candidates = [];
  if (useFuzzy && candidates.length < 3) {
    const prefix = queryLower.slice(0, 3);
    const exactIds = new Set(candidates.map((c) => c.id));
    fuzzyCandidates = (await db
      .select({
        id: authors.id,
        name: authors.name,
        bookCount: sql<number>`count(${bookAuthors.bookId})`,
      })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .where(sql`LOWER(${authors.name}) LIKE ${`%${prefix}%`}`)
      .groupBy(authors.id)
      .orderBy(sql`count(${bookAuthors.bookId}) desc`)
      .limit(20)
    ).filter((c) => !exactIds.has(c.id));
  }

  const allCandidates = [...candidates, ...fuzzyCandidates];

  // Score and rank using shared fuzzy matcher
  const results = scoreFuzzyMatches(allCandidates, q, 3);

  if (results.length === 0) {
    return NextResponse.json([]);
  }

  // For each author, fetch a few sample book covers
  const enriched = await Promise.all(
    results.map(async (author) => {
      const sampleBooks = await db
        .select({
          id: books.id,
          title: books.title,
          coverImageUrl: books.coverImageUrl,
        })
        .from(bookAuthors)
        .innerJoin(books, eq(books.id, bookAuthors.bookId))
        .where(eq(bookAuthors.authorId, author.id))
        .limit(5);

      return {
        id: author.id,
        name: author.name,
        bookCount: author.bookCount,
        sampleBooks,
      };
    })
  );

  return NextResponse.json(enriched);
}
