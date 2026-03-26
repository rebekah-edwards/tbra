import { NextRequest, NextResponse } from "next/server";
import { searchOpenLibrary, isJunkTitle } from "@/lib/openlibrary";
import { db } from "@/db";
import { books, bookAuthors, authors, blockedOlKeys } from "@/db/schema";
import { like, eq, sql, and, ne } from "drizzle-orm";
import { isBoxSetTitle, isEnglishTitle } from "@/lib/queries/books";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const trimmed = q.trim();

  // Show box sets only when the user explicitly searches for them
  const BOX_SET_QUERY = /\b(set|box\s*set|collection|boxed)\b/i;
  const showBoxSets = BOX_SET_QUERY.test(trimmed);

  // Search OL, local DB, and blocked keys in parallel
  const [olResults, localResults, blockedKeys] = await Promise.all([
    searchOpenLibrary(trimmed),
    searchLocalBooks(trimmed, showBoxSets),
    db.select({ key: blockedOlKeys.openLibraryKey }).from(blockedOlKeys).all(),
  ]);
  const blockedKeySet = new Set(blockedKeys.map((r) => r.key));

  // Filter box sets, non-English titles, and blocked OL keys from results
  const filteredOl = olResults.filter((r) =>
    (showBoxSets || !isBoxSetTitle(r.title)) && isEnglishTitle(r.title) && !blockedKeySet.has(r.key)
  );

  // Merge: local-only books (no OL key) go first, then OL results
  // Deduplicate by OL key
  const olKeys = new Set(filteredOl.map((r) => r.key));
  const uniqueLocal = localResults.filter((r) => !olKeys.has(r.key));

  // Fuzzy title dedup across the merged results — prevents showing both a local entry
  // and an OL entry for the same book with different OL keys.
  // Two-pass: first pick the best entry per normalized key, then filter.
  const merged = [...uniqueLocal, ...filteredOl];
  const bestByKey = new Map<string, number>(); // normKey → index of best entry

  function normKey(r: (typeof merged)[number]): string {
    const normTitle = r.title.toLowerCase()
      .replace(/\s*[:\-–—([\/{]\s*.*$/, "")
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/[^a-z0-9]/g, "");
    const firstAuthor = (r.author_name?.[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    return `${normTitle}:${firstAuthor}`;
  }

  // Pass 1: pick best index for each normalized key
  merged.forEach((r, idx) => {
    const key = normKey(r);
    if (!bestByKey.has(key)) {
      bestByKey.set(key, idx);
      return;
    }
    const prevIdx = bestByKey.get(key)!;
    const prev = merged[prevIdx];
    const prevIsLocal = !!(prev as Record<string, unknown>)._localBookId;
    const thisIsLocal = !!(r as Record<string, unknown>)._localBookId;
    // Prefer local results; if both local or both OL, keep the first one
    if (thisIsLocal && !prevIsLocal) {
      bestByKey.set(key, idx);
    }
  });

  // Pass 2: only keep entries that are the best for their key
  const bestIndices = new Set(bestByKey.values());
  const deduped = merged.filter((_, idx) => bestIndices.has(idx));

  return NextResponse.json(deduped);
}

/** Search local DB for books matching the query (especially non-OL books) */
async function searchLocalBooks(query: string, showBoxSets = false) {
  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      openLibraryKey: books.openLibraryKey,
      coverImageUrl: books.coverImageUrl,
      publicationYear: books.publicationYear,
      pages: books.pages,
      isbn13: books.isbn13,
      isbn10: books.isbn10,
    })
    .from(books)
    .where(and(like(books.title, `%${query.toLowerCase()}%`), ne(books.visibility, "import_only")))
    .limit(15)
    .all();

  // If case-sensitive LIKE returned nothing, try case-insensitive via SQL LOWER()
  if (rows.length === 0) {
    const fallbackRows = await db
      .select({
        id: books.id,
        title: books.title,
        openLibraryKey: books.openLibraryKey,
        coverImageUrl: books.coverImageUrl,
        publicationYear: books.publicationYear,
        pages: books.pages,
        isbn13: books.isbn13,
        isbn10: books.isbn10,
      })
      .from(books)
      .where(sql`LOWER(${books.title}) LIKE ${`%${query.toLowerCase()}%`} AND ${books.visibility} != 'import_only'`)
      .limit(15)
      .all();
    rows.push(...fallbackRows);
  }

  // Convert to OLSearchResult-compatible shape, filtering out junk/box sets
  const results = [];
  for (const row of rows) {
    if (isJunkTitle(row.title) || (!showBoxSets && isBoxSetTitle(row.title))) continue;
    const bookAuthorRows = await db
      .select({ name: authors.name, olKey: authors.openLibraryKey })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, row.id))
      .all();

    // Extract cover ID from URL if present
    let coverId: number | null = null;
    if (row.coverImageUrl) {
      const match = row.coverImageUrl.match(/\/b\/id\/(\d+)-/);
      if (match) coverId = parseInt(match[1], 10);
    }

    results.push({
      key: row.openLibraryKey ?? `local:${row.id}`,
      title: row.title,
      author_name: bookAuthorRows.map((a) => a.name),
      author_key: bookAuthorRows.map((a) => a.olKey).filter(Boolean),
      first_publish_year: row.publicationYear ?? undefined,
      cover_i: coverId,
      isbn: [row.isbn13, row.isbn10].filter(Boolean) as string[],
      number_of_pages_median: row.pages ?? undefined,
      // Flag for the frontend to know this is a local result
      _localBookId: row.id,
      _localCoverUrl: row.coverImageUrl,
    });
  }

  return results;
}
