/**
 * Shared ISBNdb external-search fallback used by BOTH the nav dropdown
 * (/api/search) and the full search page (/api/search/full).
 *
 * Handles quota enforcement, a 5-minute in-memory LRU cache, dedup by
 * ISBN + normalized title/author, and marketing-suffix stripping so
 * edition variants collapse to one entry.
 */
import { db } from "@/db";
import { books } from "@/db/schema";
import { sql } from "drizzle-orm";
import { searchISBNdbMulti, getISBNdbCoverUrl } from "@/lib/enrichment/isbndb";
import { consumeApiQuota } from "@/lib/api-quota";
import { isJunkTitle } from "@/lib/openlibrary";
import { isBoxSetTitle, isEnglishTitle } from "@/lib/queries/books";
import { matchesAllDiscriminatingTokens, tokenizeQuery } from "./relevance";

const ISBNDB_DAILY_LIMIT = 2000;
const ISBNDB_QUOTA_KEY = "isbndb_search";

const CACHE_SIZE = 200;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface ISBNdbResult {
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

interface CacheEntry { data: ISBNdbResult[]; expires: number }
const isbndbCache = new Map<string, CacheEntry>();

function cacheGet(key: string): ISBNdbResult[] | null {
  const entry = isbndbCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { isbndbCache.delete(key); return null; }
  // LRU: bump to end
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

function normalizeIsbn(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9Xx]/g, "").toUpperCase();
  return cleaned.length >= 10 ? cleaned : null;
}

// Stripping marketing suffixes ISBNdb appends without punctuation:
//   "The Amalfi Curse A Novel" → "The Amalfi Curse"
//   "The Amalfi Curse The New York Times Bestseller" → "The Amalfi Curse"
const TITLE_SUFFIXES = /\s+(?:a (?:novel|memoir|thriller|romance|novella|story|mystery|fantasy|[\w]+ (?:novel|tale|story|memoir|mystery|thriller))\b.*|the (?:new york times|#1|no\.?\s*1|international|sunday times|usa today|washington post|wall street journal).*|book \d+.*|volume \d+.*|(?:the )?(?:complete|unabridged|illustrated|deluxe|special|anniversary|collector'?s?) (?:edition|collection).*)/i;

function normalizeISBNdbTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*[:([\-–—].*/g, "")
    .replace(TITLE_SUFFIXES, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Fetch ISBNdb external results for a query.
 * - Respects the hardcoded daily quota (2000/day, atomic via api_quota_usage).
 * - Returns [] when quota is exhausted or ISBNdb returns nothing.
 * - Dedupes against local books by ISBN and by local titles passed in.
 * - Collapses editions (hardcover / paperback / Kindle / audiobook) via
 *   ISBN-dedup + marketing-suffix-stripping title normalization.
 * - If the query has ≥2 discriminating tokens, drops any external result
 *   whose title + authors doesn't contain ALL of them.
 */
export async function fetchISBNdbFallback(
  queryLower: string,
  localTitles: string[] = [],
): Promise<ISBNdbResult[]> {
  const cached = cacheGet(queryLower);
  if (cached) return cached;

  const ok = await consumeApiQuota(ISBNDB_QUOTA_KEY, ISBNDB_DAILY_LIMIT);
  if (!ok) return [];

  const isbndbBooks = await searchISBNdbMulti(queryLower, 10);

  // Dedup against local by ISBN
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

  const localTitleSet = new Set(localTitles.map((t) => t.toLowerCase()));
  const { discriminating } = tokenizeQuery(queryLower);

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
    if (localTitleSet.has(book.title.toLowerCase())) continue;

    // Enforce all-tokens rule for multi-word queries
    if (discriminating.length >= 2) {
      const combined = `${book.title} ${(book.authors ?? []).join(" ")}`;
      if (!matchesAllDiscriminatingTokens(combined, discriminating)) continue;
    }

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
  const deduped: ISBNdbResult[] = [];
  const seenTitles = new Map<string, number>();
  for (const r of results) {
    const normTitle = normalizeISBNdbTitle(r.title);
    const normAuthor = (r.author_name?.[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const key = `${normTitle}::${normAuthor}`;

    const existingIdx = seenTitles.get(key);
    if (existingIdx !== undefined) {
      const existing = deduped[existingIdx];
      const newHasCover = !!r._externalCoverUrl;
      const oldHasCover = !!existing._externalCoverUrl;
      const newTitleLen = r.title.length;
      const oldTitleLen = existing.title.length;
      const newPages = r.number_of_pages_median ?? 0;
      const oldPages = existing.number_of_pages_median ?? 0;

      const newBetter =
        (newHasCover && !oldHasCover) ||
        (newHasCover === oldHasCover && newTitleLen < oldTitleLen) ||
        (newHasCover === oldHasCover && newTitleLen === oldTitleLen && newPages > oldPages);

      if (newBetter) deduped[existingIdx] = r;
    } else {
      seenTitles.set(key, deduped.length);
      deduped.push(r);
    }
  }

  cacheSet(queryLower, deduped);
  return deduped;
}
