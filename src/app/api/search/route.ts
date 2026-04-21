import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { books, bookAuthors, authors, series, bookSeries, userBookState } from "@/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { searchBooksFTS } from "@/lib/search/search-index";
import { tokenizeQuery, matchesAllDiscriminatingTokens } from "@/lib/search/relevance";
import { fetchISBNdbFallback, type ISBNdbResult } from "@/lib/search/isbndb-fallback";
import { isJunkTitle } from "@/lib/openlibrary";

/**
 * Unified search endpoint for the nav search bar.
 * Returns books (via FTS5), series (LIKE), and authors (LIKE).
 * User search is intentionally NOT included here — reader discovery
 * has its own dedicated entry point (/people).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ books: [], series: [], authors: [] });
  }

  const trimmed = q.trim()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // Run all searches in parallel.
  //
  // The `titlePrefixMatches` query is a belt-and-suspenders guarantee that
  // if a book's title exactly matches or starts with the user's query, it
  // lands in the candidate pool — even if Meilisearch's relevance ranking
  // didn't happen to put it in the top 20. This was how "The Alchemist"
  // by Paulo Coelho was getting buried: Meilisearch was returning 20
  // "Fullmetal Alchemist" / "Alchemist Academy" / etc. entries and the
  // actual exact-title match never made it in.
  const qLower = trimmed.toLowerCase();
  const prefixPattern = `${qLower}%`;
  const [ftsResults, titlePrefixMatches, seriesResults, authorResults, user] = await Promise.all([
    searchBooksFTS(trimmed, 20),
    db.all<{ id: string }>(sql`
      SELECT id FROM books
      WHERE visibility = 'public' AND is_box_set = 0
        AND LOWER(title) LIKE ${prefixPattern}
      LIMIT 10
    `),
    searchSeries(qLower),
    searchAuthors(qLower),
    getCurrentUser(),
  ]);

  // Merge prefix-match IDs into ftsResults (preserving FTS rank order,
  // prepending anything FTS missed). The downstream exactness sort will
  // reorder these correctly — this just guarantees they're in the pool.
  const ftsIdSet = new Set(ftsResults.map((r) => r.bookId));
  const extraPrefix = titlePrefixMatches
    .filter((r) => !ftsIdSet.has(r.id))
    .map((r, i) => ({ bookId: r.id, rank: -(1000 + i) })); // high (low-number) rank so they stay visible
  const mergedResults = [...extraPrefix, ...ftsResults];

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

  if (mergedResults.length > 0) {
    const bookIds = mergedResults.map((r) => r.bookId);

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

    // Dedup by normalized title + primary author, preserving FTS rank order.
    // Also drop any result that doesn't contain EVERY discriminating query
    // token (i.e. every non-stopword) in title + authors + series. This is
    // what stops a search for "god of malice" from showing "Music and
    // Malice in Hurricane Town" just because it matches "malice".
    const { discriminating } = tokenizeQuery(trimmed);
    const seriesByBookId = new Map<string, string[]>();
    if (discriminating.length >= 2) {
      const seriesRows = await db
        .select({ bookId: bookSeries.bookId, name: series.name })
        .from(bookSeries)
        .innerJoin(series, eq(series.id, bookSeries.seriesId))
        .where(sql`${bookSeries.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
        .all();
      for (const row of seriesRows) {
        const list = seriesByBookId.get(row.bookId) ?? [];
        list.push(row.name);
        seriesByBookId.set(row.bookId, list);
      }
    }

    const seen = new Set<string>();
    for (const ftsRow of mergedResults) {
      const book = bookMap.get(ftsRow.bookId);
      if (!book) continue;

      // Drop study guides, box sets, Sneak Peek previews, ClassicNotes, etc.
      if (isJunkTitle(book.title)) continue;

      const authorNames = authorsByBook.get(book.id) ?? [];

      // Strict all-tokens check (multi-word queries only)
      if (discriminating.length >= 2) {
        const seriesNames = seriesByBookId.get(book.id) ?? [];
        const combined = `${book.title} ${authorNames.join(" ")} ${seriesNames.join(" ")}`;
        if (!matchesAllDiscriminatingTokens(combined, discriminating)) continue;
      }

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

    // Exact-phrase ranking boost — when query includes stopwords ("The
    // Alchemist"), surface results whose title exactly matches or starts
    // with the FULL query before ones that only match the discriminating
    // token ("Infinity Alchemist", "Alchemist Chronicles", etc.).
    // Stable sort by match quality; ties fall back to FTS rank order.
    const qLowerForRank = trimmed.toLowerCase();
    function exactnessScore(title: string): number {
      const t = title.toLowerCase();
      if (t === qLowerForRank) return 3;
      if (t.startsWith(qLowerForRank + " ") || t.startsWith(qLowerForRank + ":") || t.startsWith(qLowerForRank + ",")) return 2;
      if (t.startsWith(qLowerForRank)) return 1.5;
      if (t.includes(qLowerForRank)) return 1;
      return 0;
    }
    bookResults.sort((a, b) => exactnessScore(b.title) - exactnessScore(a.title));

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

  // Filter series + author results the same way: a multi-word query
  // requires every discriminating token to appear in the series/author
  // name. "god of malice" won't return a series called just "Malice".
  const { discriminating: qTokens } = tokenizeQuery(trimmed);
  const filteredSeries = qTokens.length >= 2
    ? seriesResults.filter((s) => matchesAllDiscriminatingTokens(s.name, qTokens))
    : seriesResults;
  const filteredAuthors = qTokens.length >= 2
    ? authorResults.filter((a) => matchesAllDiscriminatingTokens(a.name, qTokens))
    : authorResults;

  // Compute section order so the nav dropdown can surface whatever the
  // user most likely wanted first. An exact-title / prefix-title book
  // match beats a fuzzy series/author match on "attribute relevance".
  const relevanceScore = (s: string) => {
    const lower = (s ?? "").toLowerCase();
    if (lower === qLower) return 100;
    if (lower.startsWith(qLower)) return 70;
    if (lower.includes(qLower)) return 40;
    return 10;
  };
  const bestBookScore = bookResults.length > 0
    ? Math.max(...bookResults.slice(0, 3).map((b) => relevanceScore(b.title))) + 1
    : 0;
  const bestSeriesScore = filteredSeries.length > 0
    ? Math.max(...filteredSeries.map((s) => relevanceScore(s.name)))
    : 0;
  const bestAuthorScore = filteredAuthors.length > 0
    ? Math.max(...filteredAuthors.map((a) => relevanceScore(a.name)))
    : 0;
  const sectionOrder = [
    { type: "books", score: bestBookScore },
    { type: "series", score: bestSeriesScore },
    { type: "authors", score: bestAuthorScore },
  ].sort((a, b) => b.score - a.score).map((s) => s.type);

  // ISBNdb fallback — ONLY when the strict-filter nav dropdown would
  // otherwise show nothing. This keeps type-ahead fast in the common case
  // (our DB has the book) and only pays the 200-500ms latency when the
  // user is clearly searching for something we don't carry.
  let external: ISBNdbResult[] = [];
  const localEmpty =
    bookResults.length === 0 && filteredSeries.length === 0 && filteredAuthors.length === 0;
  if (localEmpty && trimmed.length >= 3) {
    try {
      external = await fetchISBNdbFallback(
        trimmed.toLowerCase(),
        bookResults.map((b) => b.title),
      );
    } catch (err) {
      console.warn("[search] ISBNdb fallback failed:", err);
    }
  }

  return NextResponse.json({
    books: bookResults,
    series: filteredSeries,
    authors: filteredAuthors,
    external,
    sectionOrder,
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
    // Compute the displayed "books in series" count the same way the
    // series page dedupes: one entry per unique position (+ books without
    // a position). Meilisearch's bookCount counts raw book_series rows and
    // over-counts when duplicate books share a position.
    const seriesBooks = allSeriesBooks.filter((b) => b.seriesId === row.id && !b.isBoxSet);
    const uniquePositions = new Set<number>();
    let unpositioned = 0;
    for (const b of seriesBooks) {
      if (b.position != null) uniquePositions.add(b.position);
      else unpositioned += 1;
    }
    const accurateBookCount = uniquePositions.size + unpositioned;
    return { ...row, bookCount: accurateBookCount, books: core.slice(0, 7) };
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
