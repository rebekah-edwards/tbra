import { NextRequest, NextResponse } from "next/server";
import { searchOpenLibrary, isJunkTitle } from "@/lib/openlibrary";
import { db } from "@/db";
import { books, bookAuthors, authors, blockedOlKeys } from "@/db/schema";
import { like, eq, sql, and } from "drizzle-orm";
import { isBoxSetTitle, isEnglishTitle } from "@/lib/queries/books";

/** Normalize a title for dedup — strips parentheticals, subtitles, articles, punctuation */
function normTitle(title: string): string {
  return title.toLowerCase()
    .replace(/\s*\(.*\)\s*$/, "")              // strip trailing parentheticals
    .replace(/\s*[:\-–—]\s*.*$/, "")           // strip subtitles after colon/dash
    .replace(/,?\s*a\s+(novel|memoir)\s*$/i, "") // strip "A Novel" / "A Memoir"
    .replace(/^(the|a|an)\s+/i, "")             // strip leading articles
    .replace(/[^a-z0-9]/g, "");                 // only alphanumeric
}

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
  // Also fetch OL keys of hidden/box-set books to filter from OL results
  const [olResults, localResults, blockedKeys, hiddenOlKeys] = await Promise.all([
    searchOpenLibrary(trimmed),
    searchLocalBooks(trimmed, showBoxSets),
    db.select({ key: blockedOlKeys.openLibraryKey }).from(blockedOlKeys).all(),
    db.select({ key: books.openLibraryKey })
      .from(books)
      .where(sql`${books.openLibraryKey} IS NOT NULL AND (${books.visibility} = 'hidden' OR ${books.isBoxSet} = 1)`)
      .all(),
  ]);
  const blockedKeySet = new Set(blockedKeys.map((r) => r.key));
  const hiddenKeySet = new Set(hiddenOlKeys.map((r) => r.key).filter(Boolean) as string[]);

  // Build a set of normalized titles from our public local books for dedup
  const localNormTitles = new Set(
    localResults.map((r) => normTitle(r.title))
  );

  // Filter OL results aggressively
  const filteredOl = olResults.filter((r) => {
    // 1. Blocked OL keys
    if (blockedKeySet.has(r.key)) return false;
    // 2. Hidden or box-set in our DB
    if (hiddenKeySet.has(r.key)) return false;
    // 3. Box set titles (unless explicitly searching for them)
    if (!showBoxSets && isBoxSetTitle(r.title)) return false;
    // 4. Non-English titles
    if (!isEnglishTitle(r.title)) return false;
    // 5. Junk titles (summaries, study guides, etc.)
    if (isJunkTitle(r.title)) return false;
    // 6. Duplicate of a book already in our library (by normalized title)
    //    This catches "Assassin's Apprentice (Farseer Trilogy, #1)" when we have "Assassin's Apprentice"
    if (localNormTitles.has(normTitle(r.title))) return false;
    return true;
  });

  // Merge: local books first, then filtered OL results
  // Deduplicate by OL key
  const olKeySet = new Set(filteredOl.map((r) => r.key));
  const uniqueLocal = localResults.filter((r) => !olKeySet.has(r.key));

  // Fuzzy title dedup across merged results — prevents showing both a local entry
  // and an OL entry for the same book with different OL keys.
  const merged = [...uniqueLocal, ...filteredOl];
  const bestByNorm = new Map<string, number>();

  merged.forEach((r, idx) => {
    const key = normTitle(r.title);
    if (!bestByNorm.has(key)) {
      bestByNorm.set(key, idx);
      return;
    }
    const prevIdx = bestByNorm.get(key)!;
    const prev = merged[prevIdx];
    const prevIsLocal = !!(prev as Record<string, unknown>)._localBookId;
    const thisIsLocal = !!(r as Record<string, unknown>)._localBookId;
    // Prefer local results; if both local or both OL, keep the first
    if (thisIsLocal && !prevIsLocal) {
      bestByNorm.set(key, idx);
    }
  });

  const bestIndices = new Set(bestByNorm.values());
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
    .where(and(like(books.title, `%${query.toLowerCase()}%`), eq(books.visibility, "public")))
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
      .where(sql`LOWER(${books.title}) LIKE ${`%${query.toLowerCase()}%`} AND ${books.visibility} = 'public'`)
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
