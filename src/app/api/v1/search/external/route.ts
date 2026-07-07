import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { searchISBNdbMulti, getISBNdbCoverUrl } from "@/lib/enrichment/isbndb";
import { consumeApiQuota } from "@/lib/api-quota";
import { db } from "@/db";
import { books } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { isJunkTitle } from "@/lib/openlibrary";
import { isBoxSetTitle, isEnglishTitle } from "@/lib/queries/books";

// Shares the ISBNdb search quota key + limit with /api/search/external —
// one budget across web and native.
const DAILY_LIMIT = 2000;
const QUOTA_KEY = "isbndb_search";

const normalizeIsbn = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9Xx]/g, "").toUpperCase();
  return cleaned.length >= 10 ? cleaned : null;
};

/**
 * GET /api/v1/search/external?q= — ISBNdb supplement for the native
 * search page (same flow + filters as /api/search/external).
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  if (!q || q.length < 2) return jsonOk({ results: [] });

  const ok = await consumeApiQuota(QUOTA_KEY, DAILY_LIMIT);
  if (!ok) return jsonOk({ results: [], quotaExceeded: true });

  const isbndbBooks = await searchISBNdbMulti(q, 10);

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

  const results = [];
  for (const book of isbndbBooks) {
    const isbn13 = normalizeIsbn(book.isbn13);
    const isbn10 = normalizeIsbn(book.isbn10);
    const isbn = isbn13 || isbn10 || normalizeIsbn(book.isbn);
    if (!isbn) continue;
    if (existingIsbns.has(isbn)) continue;
    if (isJunkTitle(book.title)) continue;
    if (isBoxSetTitle(book.title)) continue;
    if (!isEnglishTitle(book.title)) continue;

    const year = book.date_published ? parseInt(book.date_published.slice(0, 4), 10) : undefined;

    results.push({
      isbn,
      title: book.title,
      authors: book.authors ?? [],
      publicationYear: Number.isFinite(year) ? year : null,
      pages: book.pages ?? null,
      coverUrl: getISBNdbCoverUrl(book) ?? null,
    });
    if (results.length >= 8) break;
  }

  return jsonOk({ results });
}
