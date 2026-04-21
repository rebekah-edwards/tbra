import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  books, bookAuthors, authors, series, bookSeries,
  userBookState, userOwnedEditions, editions,
} from "@/db/schema";
import { eq, sql, and, inArray, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { searchBooksFTS } from "@/lib/search/search-index";
import { scoreFuzzyMatches } from "@/lib/search/fuzzy";
import { isJunkTitle } from "@/lib/openlibrary";
import { isBoxSetTitle, isEnglishTitle } from "@/lib/queries/books";
import { getEffectiveCoverUrl } from "@/lib/covers";
import { searchSeriesMeilisearch, searchAuthorsMeilisearch } from "@/lib/search/meilisearch";
import { tokenizeQuery, matchesAllDiscriminatingTokens } from "@/lib/search/relevance";
import { fetchISBNdbFallback, type ISBNdbResult } from "@/lib/search/isbndb-fallback";

/**
 * Unified search endpoint for the full search page.
 * Runs books (FTS/LIKE), series (LIKE+fuzzy), authors (LIKE+fuzzy),
 * ISBNdb fallback, and book-check (states/covers/formats) all in a single
 * serverless invocation — eliminating 3-4 separate cold starts per keystroke.
 */

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ books: [], series: [], authors: [], external: [] });
  }

  const trimmed = q.trim()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');
  const queryLower = trimmed.toLowerCase();

  const BOX_SET_QUERY = /\b(set|box\s*set|collection|boxed)\b/i;
  const showBoxSets = BOX_SET_QUERY.test(trimmed);

  // Use Meilisearch for series/authors when available (typo tolerance + ranking)
  const useMeilisearch = !!(process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_SEARCH_KEY);

  // Run all searches + auth check in parallel.
  // User/people search is intentionally NOT included here — reader discovery
  // lives on the dedicated /people page instead of in book search results.
  const [ftsResults, seriesResults, authorResults, user] = await Promise.all([
    searchBooksFTS(trimmed, 30),
    useMeilisearch
      ? searchSeriesViaMeilisearch(trimmed)
      : searchSeriesCandidates(queryLower).then((c) => scoreFuzzyMatches(c, trimmed, 3)),
    useMeilisearch
      ? searchAuthorsViaMeilisearch(trimmed)
      : searchAuthorCandidates(queryLower).then((c) => scoreFuzzyMatches(c, trimmed, 3)),
    getCurrentUser(),
  ]);

  // Hydrate all results in parallel
  const [bookResults, enrichedSeries, enrichedAuthors] = await Promise.all([
    hydrateBooks(ftsResults, showBoxSets, user?.userId ?? null),
    hydrateSeries(seriesResults, user?.userId ?? null),
    hydrateAuthors(authorResults),
  ]);

  // ISBNdb fallback: trigger if local results are sparse OR if none of the local
  // results are a strong title match (e.g. searching "the amalfi curse" returns
  // books about curses generally but not the specific book)
  const { discriminating: queryWords } = tokenizeQuery(trimmed);

  // Enforce the strict ALL-tokens rule on local book results. A search for
  // "god of malice" should not surface "Music and Malice in Hurricane Town".
  // Single-token queries are unaffected (the Meilisearch/FTS layer handles them).
  const strictLocalBooks = queryWords.length >= 2
    ? bookResults.filter((b) => {
        const seriesHint = ""; // series names aren't on the book result — handled below
        const combined = `${b.title} ${(b.author_name ?? []).join(" ")} ${seriesHint}`;
        return matchesAllDiscriminatingTokens(combined, queryWords);
      })
    : bookResults;

  let externalResults: ISBNdbResult[] = [];
  let hasStrongMatch = false;
  if (trimmed.length >= 3) {
    hasStrongMatch = strictLocalBooks.length > 0;
    // Also count a strong series match ("mistborn era 2") as a hit
    if (!hasStrongMatch && enrichedSeries.length > 0) {
      hasStrongMatch = enrichedSeries.some((s) =>
        queryWords.length > 0 && matchesAllDiscriminatingTokens(s.name, queryWords)
      );
    }

    if (strictLocalBooks.length < 5 || !hasStrongMatch) {
      externalResults = await fetchISBNdbFallback(
        queryLower,
        bookResults.map((b) => b.title),
      );
    }
  }

  // Use the strict list when we have a multi-word query — otherwise fall back
  // to the unfiltered list (single-word queries, queries with no discriminating
  // tokens). When external results exist and local has no strong match,
  // truncate local to 3 so the ISBNdb match surfaces.
  let finalBookResults = queryWords.length >= 2 ? strictLocalBooks : bookResults;
  if (externalResults.length > 0 && !hasStrongMatch && finalBookResults.length > 3) {
    finalBookResults = finalBookResults.slice(0, 3);
  }

  // Filter series + author results the same way
  const filteredSeries = queryWords.length >= 2
    ? enrichedSeries.filter((s) => matchesAllDiscriminatingTokens(s.name, queryWords))
    : enrichedSeries;
  const filteredAuthors = queryWords.length >= 2
    ? enrichedAuthors.filter((a) => matchesAllDiscriminatingTokens(a.name, queryWords))
    : enrichedAuthors;

  // Score each result type by relevance to the query so the client can
  // interleave sections in the right order (not always series→authors→books)
  function relevanceScore(name: string): number {
    const nameLower = name.toLowerCase();
    if (nameLower === queryLower) return 100;                        // exact match
    if (nameLower.startsWith(queryLower)) return 90;                 // starts with query
    if (queryWords.length > 0 && queryWords.every((w) => nameLower.includes(w))) return 80; // all words match
    if (queryWords.length > 0 && queryWords.some((w) => nameLower.includes(w))) return 50;  // some words match
    return 20;
  }

  // Books get a +1 tiebreaker since they're more specific/actionable
  // than a series or author result when relevance is equal
  const bestBookScore = finalBookResults.length > 0
    ? Math.max(...finalBookResults.slice(0, 3).map((b) => relevanceScore(b.title))) + 1
    : 0;
  const bestSeriesScore = filteredSeries.length > 0
    ? Math.max(...filteredSeries.map((s) => relevanceScore(s.name)))
    : 0;
  const bestAuthorScore = filteredAuthors.length > 0
    ? Math.max(...filteredAuthors.map((a) => relevanceScore(a.name)))
    : 0;
  // Book check: compute states, owned formats, effective covers for local results
  const bookCheck = await computeBookCheck(finalBookResults, user?.userId ?? null);

  const response = NextResponse.json({
    books: finalBookResults,
    series: filteredSeries,
    authors: filteredAuthors,
    people: [],
    external: externalResults,
    check: bookCheck,
    sectionOrder: [
      { type: "series", score: bestSeriesScore },
      { type: "authors", score: bestAuthorScore },
      { type: "books", score: bestBookScore },
    ].sort((a, b) => b.score - a.score).map((s) => s.type),
  });

  // Cache anonymous search results at the edge for 30s (no user-specific data)
  if (!user) {
    response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  }

  return response;
}

// ─── Book search (FTS/LIKE → hydrate) ───

async function hydrateBooks(
  ftsResults: { bookId: string; rank: number }[],
  showBoxSets: boolean,
  userId: string | null,
) {
  if (ftsResults.length === 0) return [];

  const bookIds = ftsResults.map((r) => r.bookId);

  const [bookRows, authorRows] = await Promise.all([
    db.select({
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
    db.select({ bookId: bookAuthors.bookId, name: authors.name, olKey: authors.openLibraryKey })
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

  return results;
}

// ─── Series search (LIKE → fuzzy candidates) ───

// Meilisearch wrappers — return in the same shape as the fuzzy-scored candidates
async function searchSeriesViaMeilisearch(query: string) {
  try {
    return await searchSeriesMeilisearch(query, 3);
  } catch {
    // Fallback to DB if Meilisearch fails
    const candidates = await searchSeriesCandidates(query.toLowerCase());
    return scoreFuzzyMatches(candidates, query, 3);
  }
}

async function searchAuthorsViaMeilisearch(query: string) {
  try {
    return await searchAuthorsMeilisearch(query, 3);
  } catch {
    const candidates = await searchAuthorCandidates(query.toLowerCase());
    return scoreFuzzyMatches(candidates, query, 3);
  }
}

async function searchSeriesCandidates(queryLower: string) {
  const useFuzzy = queryLower.length >= 4;

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

  return [...candidates, ...fuzzyCandidates];
}

async function hydrateSeries(
  scored: { id: string; name: string; bookCount: number }[],
  userId: string | null,
) {
  if (scored.length === 0) return [];

  const seriesIds = scored.map((s) => s.id);

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
    .where(and(
      sql`${bookSeries.seriesId} IN (${sql.join(seriesIds.map((id) => sql`${id}`), sql`, `)})`,
      isNotNull(bookSeries.positionInSeries),
    ))
    .orderBy(bookSeries.positionInSeries);

  const coreBooks = allSeriesBooks.filter(
    (b) => b.position != null && Number.isInteger(b.position) && !b.isBoxSet,
  );
  const allBookIds = coreBooks.map((b) => b.bookId);

  const [allAuthors, stateRows] = await Promise.all([
    allBookIds.length > 0
      ? db.select({ bookId: bookAuthors.bookId, name: authors.name })
          .from(bookAuthors)
          .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
          .where(sql`${bookAuthors.bookId} IN (${sql.join(allBookIds.map((id) => sql`${id}`), sql`, `)})`)
          .all()
      : [],
    userId && allBookIds.length > 0
      ? db.select({ bookId: userBookState.bookId, state: userBookState.state, ownedFormats: userBookState.ownedFormats })
          .from(userBookState)
          .where(and(
            eq(userBookState.userId, userId),
            sql`${userBookState.bookId} IN (${sql.join(allBookIds.map((id) => sql`${id}`), sql`, `)})`,
          ))
          .all()
      : [],
  ]);

  const authorsByBook = new Map<string, string[]>();
  for (const row of allAuthors) {
    const list = authorsByBook.get(row.bookId) ?? [];
    list.push(row.name);
    authorsByBook.set(row.bookId, list);
  }

  const stateMap = new Map<string, { state: string | null; ownedFormats: string[] }>();
  if (stateRows) {
    for (const r of stateRows) {
      stateMap.set(r.bookId, {
        state: r.state,
        ownedFormats: r.ownedFormats ? JSON.parse(r.ownedFormats) : [],
      });
    }
  }

  return scored.map((s) => {
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

    // Use the dedup'd position count so the displayed "X books in series"
    // matches what the series page actually renders (one book per position).
    const uniquePositions = new Set<number>();
    for (const b of seriesCoreBooks) {
      if (b.position != null) uniquePositions.add(b.position);
    }
    const accurateBookCount = uniquePositions.size || s.bookCount;

    return {
      id: s.id,
      name: s.name,
      bookCount: accurateBookCount,
      books: seriesCoreBooks,
    };
  });
}

// ─── Author search (LIKE → fuzzy candidates → sample books) ───

async function searchAuthorCandidates(queryLower: string) {
  const useFuzzy = queryLower.length >= 4;

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

  return [...candidates, ...fuzzyCandidates];
}

async function hydrateAuthors(scored: { id: string; name: string; bookCount: number }[]) {
  if (scored.length === 0) return [];

  // Batch all sample books in one query instead of per-author
  const authorIds = scored.map((a) => a.id);
  const sampleRows = await db
    .select({
      authorId: bookAuthors.authorId,
      id: books.id,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
    })
    .from(bookAuthors)
    .innerJoin(books, eq(books.id, bookAuthors.bookId))
    .where(sql`${bookAuthors.authorId} IN (${sql.join(authorIds.map((id) => sql`${id}`), sql`, `)})`)

  const samplesByAuthor = new Map<string, { id: string; title: string; coverImageUrl: string | null }[]>();
  for (const row of sampleRows) {
    const list = samplesByAuthor.get(row.authorId) ?? [];
    if (list.length < 5) list.push({ id: row.id, title: row.title, coverImageUrl: row.coverImageUrl });
    samplesByAuthor.set(row.authorId, list);
  }

  return scored.map((a) => ({
    id: a.id,
    name: a.name,
    bookCount: a.bookCount,
    sampleBooks: samplesByAuthor.get(a.id) ?? [],
  }));
}

// ─── Book check (states, owned formats, effective covers) ───

async function computeBookCheck(
  bookResults: { key: string; _localBookId?: string; _localCoverUrl?: string | null }[],
  userId: string | null,
) {
  const existing: Record<string, string> = {};
  const states: Record<string, string> = {};
  const ownedFormats: Record<string, string[]> = {};
  const covers: Record<string, string> = {};

  if (bookResults.length === 0) return { existing, states, ownedFormats, covers };

  // All local books — map key → bookId and key → coverUrl
  const bookIdToKey: Record<string, string> = {};
  const bookIdToCover: Record<string, string | null> = {};
  const bookIds: string[] = [];

  for (const r of bookResults) {
    if (r._localBookId) {
      existing[r.key] = r._localBookId;
      bookIdToKey[r._localBookId] = r.key;
      bookIdToCover[r._localBookId] = r._localCoverUrl ?? null;
      bookIds.push(r._localBookId);
    }
  }

  if (!userId || bookIds.length === 0) {
    // No user — return base covers
    for (const [key, bookId] of Object.entries(bookIdToKey)) {
      const cover = bookIdToCover[key];
      if (cover) covers[bookIdToKey[key] ?? key] = cover;
    }
    for (const bookId of bookIds) {
      const olKey = bookIdToKey[bookId];
      if (olKey && bookIdToCover[bookId]) covers[olKey] = bookIdToCover[bookId]!;
    }
    return { existing, states, ownedFormats, covers };
  }

  // Fetch states + editions in parallel
  const [stateRows, editionRows] = await Promise.all([
    db.select({
      bookId: userBookState.bookId,
      state: userBookState.state,
      ownedFormats: userBookState.ownedFormats,
      activeFormats: userBookState.activeFormats,
    })
    .from(userBookState)
    .where(and(eq(userBookState.userId, userId), inArray(userBookState.bookId, bookIds)))
    .all(),
    db.select({
      bookId: userOwnedEditions.bookId,
      format: userOwnedEditions.format,
      coverId: editions.coverId,
    })
    .from(userOwnedEditions)
    .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
    .where(and(eq(userOwnedEditions.userId, userId), inArray(userOwnedEditions.bookId, bookIds)))
    .all(),
  ]);

  const stateByBookId: Record<string, (typeof stateRows)[0]> = {};
  for (const row of stateRows) {
    const olKey = bookIdToKey[row.bookId];
    if (olKey && row.state) states[olKey] = row.state;
    if (olKey && row.ownedFormats) ownedFormats[olKey] = JSON.parse(row.ownedFormats);
    stateByBookId[row.bookId] = row;
  }

  const editionsByBook: Record<string, { format: string; coverId: number | null }[]> = {};
  for (const ed of editionRows) {
    if (!editionsByBook[ed.bookId]) editionsByBook[ed.bookId] = [];
    editionsByBook[ed.bookId].push({ format: ed.format, coverId: ed.coverId });
  }

  for (const bookId of bookIds) {
    const olKey = bookIdToKey[bookId];
    if (!olKey) continue;

    const stateRow = stateByBookId[bookId];
    const isActivelyReading = stateRow?.state === "currently_reading" || stateRow?.state === "paused";
    const activeFormats = stateRow?.activeFormats ? JSON.parse(stateRow.activeFormats) as string[] : [];
    const owned = stateRow?.ownedFormats ? JSON.parse(stateRow.ownedFormats) as string[] : [];

    const effectiveCover = getEffectiveCoverUrl({
      baseCoverUrl: bookIdToCover[bookId],
      editionSelections: editionsByBook[bookId] ?? [],
      activeFormats,
      ownedFormats: owned,
      isActivelyReading,
      size: "M",
    });

    if (effectiveCover) covers[olKey] = effectiveCover;
  }

  return { existing, states, ownedFormats, covers };
}
