import { NextResponse } from "next/server";
import { db } from "@/db";
import { authors, bookAuthors, books } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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

  // Score each candidate
  type ScoredAuthor = (typeof candidates)[number] & { matchScore: number };
  const scored: ScoredAuthor[] = [];

  for (const author of allCandidates) {
    const nameLower = author.name.toLowerCase();
    const isSubstring = nameLower.includes(queryLower);

    if (useFuzzy && !isSubstring) {
      // Fuzzy word-level matching
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
      scored.push({ ...author, matchScore: totalDistance + 10 }); // fuzzy penalty
    } else if (isSubstring) {
      // Exact substring bonus
      const startsWithBonus = nameLower.startsWith(queryLower) ? -5 : 0;
      scored.push({ ...author, matchScore: startsWithBonus });
    }
    // else: short query, not a substring match — skip
  }

  // Sort by match quality, then by book count
  scored.sort((a, b) => {
    if (a.matchScore !== b.matchScore) return a.matchScore - b.matchScore;
    return b.bookCount - a.bookCount;
  });

  const results = scored.slice(0, 3);

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
