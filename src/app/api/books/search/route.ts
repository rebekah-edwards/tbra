import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { books, bookAuthors, authors, bookCategoryRatings } from "@/db/schema";
import { eq, sql, and, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { userBookState } from "@/db/schema";

interface LocalBookResult {
  id: string;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  publicationYear: number | null;
  state: string | null;
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for fuzzy matching / typo tolerance.
 */
function editDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Use single-row DP for memory efficiency
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

/**
 * Score a book result for ranking. Higher = better.
 * Prioritizes: exact match > has cover > has content ratings > shorter/cleaner title
 */
function scoreBook(
  book: { title: string; coverImageUrl: string | null; hasRatings: boolean },
  query: string
): number {
  let score = 0;
  const titleLower = book.title.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact title match bonus
  if (titleLower === queryLower) score += 100;
  // Starts with query bonus
  else if (titleLower.startsWith(queryLower)) score += 50;

  // Has cover image
  if (book.coverImageUrl) score += 30;

  // Has content ratings (enriched book)
  if (book.hasRatings) score += 20;

  // Penalize parenthetical titles like "Red Rising (Red Rising Saga, #1)"
  if (book.title.includes("(")) score -= 25;

  // Prefer shorter/cleaner titles
  score -= Math.min(book.title.length, 50) * 0.2;

  return score;
}

/**
 * Normalize a title for deduplication comparison.
 * Strips parenthetical suffixes and common subtitles.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*\(.*\)\s*$/, "") // strip trailing parentheticals
    .replace(/\s*:\s+a\s+novel\s*$/i, "") // strip ": A Novel"
    .replace(/[^a-z0-9]/g, "") // only alphanumeric
    .trim();
}

/**
 * Local-only book search for the search bar dropdown.
 * Fast — no external API calls, just local SQLite.
 * Returns books already in the tbr*a database.
 *
 * Features:
 * - Fuzzy matching (typo tolerance via edit distance)
 * - Deduplication (prefers canonical editions with covers/ratings)
 * - Prioritizes enriched books
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const trimmed = q.trim().toLowerCase();

  // Build a looser query for fuzzy matching:
  // Use first 2 characters for prefix match to get broader candidate set,
  // then score/filter in JS. For very short queries (2-3 chars), use exact LIKE.
  const prefix = trimmed.slice(0, 2);
  const useFuzzy = trimmed.length >= 3;

  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      publicationYear: books.publicationYear,
    })
    .from(books)
    .where(
      and(
        useFuzzy
          ? sql`LOWER(${books.title}) LIKE ${`%${prefix}%`}`
          : sql`LOWER(${books.title}) LIKE ${`%${trimmed}%`}`,
        ne(books.visibility, "import_only")
      )
    )
    .limit(useFuzzy ? 100 : 20)
    .all();

  // For fuzzy matching, score each result by edit distance
  // between query and the title (or substring of the title)
  type ScoredRow = (typeof rows)[number] & {
    fuzzyScore: number;
    hasRatings: boolean;
    authorNames: string[];
  };

  // Batch fetch authors for all books
  const bookIds = rows.map((r) => r.id);
  const allBookAuthors =
    bookIds.length > 0
      ? await db
          .select({
            bookId: bookAuthors.bookId,
            name: authors.name,
          })
          .from(bookAuthors)
          .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
          .where(
            sql`${bookAuthors.bookId} IN (${sql.join(
              bookIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
          .all()
      : [];

  const authorsByBook = new Map<string, string[]>();
  for (const row of allBookAuthors) {
    const existing = authorsByBook.get(row.bookId) ?? [];
    existing.push(row.name);
    authorsByBook.set(row.bookId, existing);
  }

  // Batch check which books have content ratings
  const booksWithRatings = new Set<string>();
  if (bookIds.length > 0) {
    const ratingRows = await db
      .select({ bookId: bookCategoryRatings.bookId })
      .from(bookCategoryRatings)
      .where(
        sql`${bookCategoryRatings.bookId} IN (${sql.join(
          bookIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      )
      .groupBy(bookCategoryRatings.bookId)
      .all();
    for (const r of ratingRows) {
      booksWithRatings.add(r.bookId);
    }
  }

  // Score and filter
  const scored: ScoredRow[] = [];
  for (const row of rows) {
    const titleLower = row.title.toLowerCase();
    const authorNames = authorsByBook.get(row.id) ?? [];
    const hasRatings = booksWithRatings.has(row.id);

    if (useFuzzy) {
      // Check if title contains the query as substring (original behavior)
      const isSubstringMatch = titleLower.includes(trimmed);

      // Compute fuzzy score using edit distance on individual words
      // Compare query against title words to find best partial match
      const titleWords = titleLower.split(/\s+/);
      const queryWords = trimmed.split(/\s+/);

      // For multi-word queries, check word-by-word fuzzy match
      let matchedWords = 0;
      let totalDistance = 0;

      for (const qWord of queryWords) {
        let bestDist = qWord.length; // worst case = entire word wrong
        for (const tWord of titleWords) {
          // Also check author name words for fuzzy matching
          const dist = editDistance(qWord, tWord.slice(0, qWord.length + 2));
          bestDist = Math.min(bestDist, dist);
        }
        // Also check against author names
        for (const authorName of authorNames) {
          for (const aWord of authorName.toLowerCase().split(/\s+/)) {
            const dist = editDistance(qWord, aWord.slice(0, qWord.length + 2));
            bestDist = Math.min(bestDist, dist);
          }
        }

        // Allow up to ~30% of word length as typos
        const threshold = Math.max(1, Math.floor(qWord.length * 0.35));
        if (bestDist <= threshold) {
          matchedWords++;
          totalDistance += bestDist;
        }
      }

      const isFuzzyMatch =
        matchedWords >= Math.ceil(queryWords.length * 0.7);

      if (!isSubstringMatch && !isFuzzyMatch) continue;

      const fuzzyScore = isSubstringMatch ? 0 : totalDistance;
      scored.push({ ...row, fuzzyScore, hasRatings, authorNames });
    } else {
      // Short query — must be substring match
      if (!titleLower.includes(trimmed)) continue;
      scored.push({ ...row, fuzzyScore: 0, hasRatings, authorNames });
    }
  }

  // Sort: exact/substring matches first (fuzzyScore=0), then by quality score
  scored.sort((a, b) => {
    // Fuzzy matches go after exact matches
    if (a.fuzzyScore !== b.fuzzyScore) return a.fuzzyScore - b.fuzzyScore;
    // Then by quality score
    return (
      scoreBook({ title: b.title, coverImageUrl: b.coverImageUrl, hasRatings: b.hasRatings }, trimmed) -
      scoreBook({ title: a.title, coverImageUrl: a.coverImageUrl, hasRatings: a.hasRatings }, trimmed)
    );
  });

  // Deduplicate: group by normalized title + author, keep best
  const seen = new Map<string, ScoredRow>();
  const deduplicated: ScoredRow[] = [];

  for (const row of scored) {
    const normTitle = normalizeTitle(row.title);
    // Use first author for grouping (if any)
    const primaryAuthor = (row.authorNames[0] ?? "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    const dedupeKey = `${normTitle}::${primaryAuthor}`;

    const existing = seen.get(dedupeKey);
    if (existing) {
      // Keep the one with better score
      const existingScore = scoreBook(
        { title: existing.title, coverImageUrl: existing.coverImageUrl, hasRatings: existing.hasRatings },
        trimmed
      );
      const newScore = scoreBook(
        { title: row.title, coverImageUrl: row.coverImageUrl, hasRatings: row.hasRatings },
        trimmed
      );
      if (newScore > existingScore) {
        // Replace in results
        const idx = deduplicated.indexOf(existing);
        if (idx !== -1) deduplicated[idx] = row;
        seen.set(dedupeKey, row);
      }
      // Otherwise skip this duplicate
    } else {
      seen.set(dedupeKey, row);
      deduplicated.push(row);
    }
  }

  // Take top 8 results
  const topResults = deduplicated.slice(0, 8);

  // Build final results
  const results: LocalBookResult[] = topResults.map((row) => ({
    id: row.id,
    title: row.title,
    coverImageUrl: row.coverImageUrl,
    authors: row.authorNames,
    publicationYear: row.publicationYear,
    state: null,
  }));

  // Fetch reading states if user is logged in
  const user = await getCurrentUser();
  if (user && results.length > 0) {
    const resultBookIds = results.map((r) => r.id);
    const stateRows = await db
      .select({
        bookId: userBookState.bookId,
        state: userBookState.state,
      })
      .from(userBookState)
      .where(
        and(
          eq(userBookState.userId, user.userId),
          sql`${userBookState.bookId} IN (${sql.join(
            resultBookIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )
      )
      .all();

    const stateMap = new Map(stateRows.map((r: { bookId: string; state: string | null }) => [r.bookId, r.state]));
    for (const result of results) {
      result.state = stateMap.get(result.id) as string | null ?? null;
    }
  }

  return NextResponse.json(results);
}
