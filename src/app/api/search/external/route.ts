import { NextRequest, NextResponse } from "next/server";
import { searchISBNdbMulti, getISBNdbCoverUrl } from "@/lib/enrichment/isbndb";
import { consumeApiQuota } from "@/lib/api-quota";
import { db } from "@/db";
import { books } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { isJunkTitle } from "@/lib/openlibrary";
import { isBoxSetTitle, isEnglishTitle } from "@/lib/queries/books";

/**
 * Hard daily cap for search-driven ISBNdb calls.
 * We reserve most of the 15K/day ISBNdb premium quota for enrichment.
 * Search calls are capped at 2,000/day — well below the enrichment budget.
 */
const DAILY_LIMIT = 2000;
const QUOTA_KEY = "isbndb_search";

/**
 * In-memory LRU cache for search responses.
 * Reduces quota burn when users type the same query multiple times
 * (backspace + retry, pagination, etc.).
 *
 * NOTE: This cache is per-serverless-instance. On Vercel, cold starts
 * reset it. That's fine — it's an optimization, not a correctness guarantee.
 */
const CACHE_SIZE = 200;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: ExternalSearchResult[];
  expires: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): ExternalSearchResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  // LRU: re-insert to move to end
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function cacheSet(key: string, data: ExternalSearchResult[]) {
  if (cache.size >= CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Shape returned to the client. Compatible with the search page's existing
 * OLSearchResult-style rendering (title, authors, cover, year, key).
 */
interface ExternalSearchResult {
  /** Stable identifier — use ISBN so the client can request an import later */
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  number_of_pages_median?: number;
  /** Direct image URL from ISBNdb (not an OL cover ID) */
  _externalCoverUrl?: string;
  /** Source marker so the client knows this needs ISBNdb-style import */
  _source: "isbndb";
  _isbn13?: string | null;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 3) {
    // Require at least 3 chars to avoid burning quota on single-letter queries
    return NextResponse.json({ results: [], quotaRemaining: null });
  }

  const trimmed = q.trim().toLowerCase();

  // 1. Cache lookup
  const cached = cacheGet(trimmed);
  if (cached) {
    return NextResponse.json({ results: cached, quotaRemaining: null, cached: true });
  }

  // 2. Quota check (atomic)
  const ok = await consumeApiQuota(QUOTA_KEY, DAILY_LIMIT);
  if (!ok) {
    return NextResponse.json(
      {
        results: [],
        quotaExceeded: true,
        error: "Daily external search limit reached. Try again tomorrow.",
      },
      { status: 429 }
    );
  }

  // 3. Query ISBNdb
  const isbndbBooks = await searchISBNdbMulti(trimmed, 10);

  // 4. Filter out books we already have locally (by ISBN) so we don't show dupes.
  // Normalize ISBNs to digits-only before the comparison — ISBNdb sometimes
  // returns hyphenated forms while our DB stores unhyphenated (or vice versa),
  // so exact equality was missing matches and causing Hell's Heart-style
  // duplicate-insert attempts downstream.
  const normalizeIsbn = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const cleaned = s.replace(/[^0-9Xx]/g, "").toUpperCase();
    return cleaned.length >= 10 ? cleaned : null;
  };

  const isbns = isbndbBooks
    .map((b) => normalizeIsbn(b.isbn13) || normalizeIsbn(b.isbn10) || normalizeIsbn(b.isbn))
    .filter(Boolean) as string[];

  let existingIsbns = new Set<string>();
  if (isbns.length > 0) {
    const rows = await db
      .select({ isbn13: books.isbn13, isbn10: books.isbn10 })
      .from(books)
      .where(or(...isbns.flatMap((i) => [eq(books.isbn13, i), eq(books.isbn10, i)])));
    existingIsbns = new Set(
      rows.flatMap((r) => [normalizeIsbn(r.isbn13), normalizeIsbn(r.isbn10)].filter(Boolean) as string[])
    );
  }

  // 5. Transform + filter
  const results: ExternalSearchResult[] = [];
  for (const book of isbndbBooks) {
    const isbn13 = normalizeIsbn(book.isbn13);
    const isbn10 = normalizeIsbn(book.isbn10);
    const isbn = isbn13 || isbn10 || normalizeIsbn(book.isbn);
    if (!isbn) continue;

    // Skip if we already have this book locally (compare against normalized set)
    if (existingIsbns.has(isbn)) continue;

    // Same junk/box-set filters we use for OL results
    if (isJunkTitle(book.title)) continue;
    if (isBoxSetTitle(book.title)) continue;
    if (!isEnglishTitle(book.title)) continue;

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

  // 6. Cache and return
  cacheSet(trimmed, results);
  return NextResponse.json({ results, quotaRemaining: DAILY_LIMIT });
}
