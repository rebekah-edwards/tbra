import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  books, bookAuthors, authors, series, bookSeries,
  userBookState, userOwnedEditions, editions, users,
} from "@/db/schema";
import { eq, sql, and, inArray, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { searchBooksFTS } from "@/lib/search/search-index";
import { scoreFuzzyMatches } from "@/lib/search/fuzzy";
import { isJunkTitle } from "@/lib/openlibrary";
import { isBoxSetTitle, isEnglishTitle } from "@/lib/queries/books";
import { searchISBNdbMulti, getISBNdbCoverUrl } from "@/lib/enrichment/isbndb";
import { consumeApiQuota } from "@/lib/api-quota";
import { getEffectiveCoverUrl } from "@/lib/covers";
import { searchSeriesMeilisearch, searchAuthorsMeilisearch } from "@/lib/search/meilisearch";

/**
 * Unified search endpoint for the full search page.
 * Runs books (FTS/LIKE), series (LIKE+fuzzy), authors (LIKE+fuzzy),
 * ISBNdb fallback, and book-check (states/covers/formats) all in a single
 * serverless invocation — eliminating 3-4 separate cold starts per keystroke.
 */

const ISBNDB_DAILY_LIMIT = 2000;
const ISBNDB_QUOTA_KEY = "isbndb_search";

// In-memory LRU cache for ISBNdb results (per-instance, reset on cold start)
const CACHE_SIZE = 200;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: ISBNdbResult[];
  expires: number;
}

const isbndbCache = new Map<string, CacheEntry>();

function cacheGet(key: string): ISBNdbResult[] | null {
  const entry = isbndbCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { isbndbCache.delete(key); return null; }
  isbndbCache.delete(key);
  isbndbCache.set(key, entry);
  return entry.data;
}

function cacheSet(key: string, data: ISBNdbResult[]) {
  if (isbndbCache.size >= CACHE_SIZE) {
    const oldestKey = isbndbCache.keys().next().value;
    if (oldestKey) isbndbCache.delete(oldestKey);
  }
  isbndbCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

interface ISBNdbResult {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  number_of_pages_median?: number;
  _externalCoverUrl?: string;
  _source: "isbndb";
  _isbn13?: string | null;
}

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

  // Run all searches + auth check in parallel
  const [ftsResults, seriesResults, authorResults, userResults, user] = await Promise.all([
    searchBooksFTS(trimmed, 30),
    useMeilisearch
      ? searchSeriesViaMeilisearch(trimmed)
      : searchSeriesCandidates(queryLower).then((c) => scoreFuzzyMatches(c, trimmed, 3)),
    useMeilisearch
      ? searchAuthorsViaMeilisearch(trimmed)
      : searchAuthorCandidates(queryLower).then((c) => scoreFuzzyMatches(c, trimmed, 3)),
    searchUsers(queryLower),
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
  const STOP_WORDS = new Set(["the", "a", "an", "and", "of", "in", "to", "for", "is", "on", "by"]);
  const queryWords = queryLower.split(/\s+/).filter((w) => !STOP_WORDS.has(w));

  let externalResults: ISBNdbResult[] = [];
  let hasStrongMatch = false;
  if (trimmed.length >= 3) {
    hasStrongMatch = bookResults.some((b) => {
      // Check if all query words appear in title + author + series combined
      const titleLower = b.title.toLowerCase();
      const authorLower = (b.author_name ?? []).join(" ").toLowerCase();
      const combined = `${titleLower} ${authorLower}`;
      return queryWords.length > 0 && queryWords.every((w) => combined.includes(w));
    });
    // Also check series names for strong match (e.g. "mistborn era 2")
    if (!hasStrongMatch && enrichedSeries.length > 0) {
      hasStrongMatch = enrichedSeries.some((s) => {
        const nameLower = s.name.toLowerCase();
        return queryWords.length > 0 && queryWords.every((w) => nameLower.includes(w));
      });
    }

    if (bookResults.length < 5 || !hasStrongMatch) {
      externalResults = await fetchISBNdbResults(queryLower, bookResults);
    }
  }

  // When ISBNdb returned results and no local book is a strong match,
  // truncate weak local results so the actual match isn't buried under
  // 20 "curse"-only books when the user searched "the amalfi curse"
  let finalBookResults = bookResults;
  if (externalResults.length > 0 && !hasStrongMatch && bookResults.length > 3) {
    finalBookResults = bookResults.slice(0, 3);
  }

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
  const bestSeriesScore = enrichedSeries.length > 0
    ? Math.max(...enrichedSeries.map((s) => relevanceScore(s.name)))
    : 0;
  const bestAuthorScore = enrichedAuthors.length > 0
    ? Math.max(...enrichedAuthors.map((a) => relevanceScore(a.name)))
    : 0;
  const bestPeopleScore = userResults.length > 0
    ? Math.max(...userResults.map((u) => relevanceScore(u.displayName || u.username || "")))
    : 0;

  // Book check: compute states, owned formats, effective covers for local results
  const bookCheck = await computeBookCheck(finalBookResults, user?.userId ?? null);

  const response = NextResponse.json({
    books: finalBookResults,
    series: enrichedSeries,
    authors: enrichedAuthors,
    people: userResults,
    external: externalResults,
    check: bookCheck,
    sectionOrder: [
      { type: "series", score: bestSeriesScore },
      { type: "authors", score: bestAuthorScore },
      { type: "books", score: bestBookScore },
      { type: "people", score: bestPeopleScore },
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

    return {
      id: s.id,
      name: s.name,
      bookCount: s.bookCount,
      books: seriesCoreBooks,
    };
  });
}

// ─── Author search (LIKE → fuzzy candidates → sample books) ───

// ─── User/people search ───

async function searchUsers(queryLower: string) {
  if (queryLower.length < 2) return [];
  const likePattern = `%${queryLower}%`;
  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(sql`(LOWER(${users.displayName}) LIKE ${likePattern} OR LOWER(${users.username}) LIKE ${likePattern})`)
    .limit(5)
    .all();
}

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

// ─── ISBNdb external fallback ───

async function fetchISBNdbResults(
  queryLower: string,
  localBooks: { key: string; title: string }[],
): Promise<ISBNdbResult[]> {
  // Check cache first
  const cached = cacheGet(queryLower);
  if (cached) return cached;

  // Check quota
  const ok = await consumeApiQuota(ISBNDB_QUOTA_KEY, ISBNDB_DAILY_LIMIT);
  if (!ok) return [];

  const normalizeIsbn = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const cleaned = s.replace(/[^0-9Xx]/g, "").toUpperCase();
    return cleaned.length >= 10 ? cleaned : null;
  };

  const isbndbBooks = await searchISBNdbMulti(queryLower, 10);

  // Filter out books already in DB by ISBN
  const isbns = isbndbBooks
    .map((b) => normalizeIsbn(b.isbn13) || normalizeIsbn(b.isbn10) || normalizeIsbn(b.isbn))
    .filter(Boolean) as string[];

  let existingIsbns = new Set<string>();
  if (isbns.length > 0) {
    const rows = await db
      .select({ isbn13: books.isbn13, isbn10: books.isbn10 })
      .from(books)
      .where(sql`${books.isbn13} IN (${sql.join(isbns.map((i) => sql`${i}`), sql`, `)}) OR ${books.isbn10} IN (${sql.join(isbns.map((i) => sql`${i}`), sql`, `)})`);
    existingIsbns = new Set(
      rows.flatMap((r) => [normalizeIsbn(r.isbn13), normalizeIsbn(r.isbn10)].filter(Boolean) as string[]),
    );
  }

  // Also dedup against local results by title
  const localTitles = new Set(localBooks.map((b) => b.title.toLowerCase()));

  const results: ISBNdbResult[] = [];
  for (const book of isbndbBooks) {
    const isbn13 = normalizeIsbn(book.isbn13);
    const isbn10 = normalizeIsbn(book.isbn10);
    const isbn = isbn13 || isbn10 || normalizeIsbn(book.isbn);
    if (!isbn) continue;
    if (existingIsbns.has(isbn)) continue;
    if (isJunkTitle(book.title)) continue;
    if (isBoxSetTitle(book.title)) continue;
    if (!isEnglishTitle(book.title)) continue;
    if (localTitles.has(book.title.toLowerCase())) continue;

    const year = book.date_published
      ? parseInt(book.date_published.slice(0, 4), 10)
      : undefined;

    results.push({
      key: `isbndb:${isbn}`,
      title: book.title,
      author_name: book.authors ?? [],
      first_publish_year: Number.isFinite(year) ? year : undefined,
      isbn: [isbn13, isbn10, book.isbn].filter(Boolean) as string[],
      number_of_pages_median: book.pages,
      _externalCoverUrl: getISBNdbCoverUrl(book) ?? undefined,
      _source: "isbndb",
      _isbn13: isbn13,
    });
  }

  // Deduplicate editions (hardcover, paperback, Kindle, audiobook of same book)
  // ISBNdb titles often have marketing suffixes appended without punctuation:
  //   "The Amalfi Curse A Novel"
  //   "The Amalfi Curse A Bewitching Tale of Sunken Treasure..."
  //   "The Amalfi Curse The New York Times Bestseller"
  // Strip marketing suffixes ISBNdb appends without punctuation:
  //   "The Amalfi Curse A Novel" → "The Amalfi Curse"
  //   "The Amalfi Curse A Bewitching Tale of..." → "The Amalfi Curse"
  //   "The Amalfi Curse The New York Times Bestseller" → "The Amalfi Curse"
  const TITLE_SUFFIXES = /\s+(?:a (?:novel|memoir|thriller|romance|novella|story|mystery|fantasy|[\w]+ (?:novel|tale|story|memoir|mystery|thriller))\b.*|the (?:new york times|#1|no\.?\s*1|international|sunday times|usa today|washington post|wall street journal).*|book \d+.*|volume \d+.*|(?:the )?(?:complete|unabridged|illustrated|deluxe|special|anniversary|collector'?s?) (?:edition|collection).*)/i;

  function normalizeISBNdbTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/\s*[:([\-–—].*/g, "")   // strip after punctuation separators
      .replace(TITLE_SUFFIXES, "")        // strip bare marketing suffixes
      .replace(/[^a-z0-9]/g, "");
  }

  const deduped: ISBNdbResult[] = [];
  const seenTitles = new Map<string, number>();
  for (const r of results) {
    const normTitle = normalizeISBNdbTitle(r.title);
    const normAuthor = (r.author_name?.[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const key = `${normTitle}::${normAuthor}`;

    const existingIdx = seenTitles.get(key);
    if (existingIdx !== undefined) {
      // Replace if the new edition is better: prefer cover, then cleanest title, then most pages
      const existing = deduped[existingIdx];
      const newHasCover = !!r._externalCoverUrl;
      const oldHasCover = !!existing._externalCoverUrl;
      const newTitleLen = r.title.length;
      const oldTitleLen = existing.title.length;
      const newPages = r.number_of_pages_median ?? 0;
      const oldPages = existing.number_of_pages_median ?? 0;

      // Prefer: has cover > shorter/cleaner title > more pages
      const newBetter =
        (newHasCover && !oldHasCover) ||
        (newHasCover === oldHasCover && newTitleLen < oldTitleLen) ||
        (newHasCover === oldHasCover && newTitleLen === oldTitleLen && newPages > oldPages);

      if (newBetter) {
        deduped[existingIdx] = r;
      }
    } else {
      seenTitles.set(key, deduped.length);
      deduped.push(r);
    }
  }

  cacheSet(queryLower, deduped);
  return deduped;
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
