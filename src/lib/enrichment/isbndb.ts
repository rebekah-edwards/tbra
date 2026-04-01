/**
 * ISBNdb API integration — Premium plan (15K calls/day, 3/sec)
 * Primary metadata source after OpenLibrary.
 */

const ISBNDB_BASE = "https://api2.isbndb.com";
const DELAY_MS = 350; // stay under 3/sec

export interface ISBNdbBook {
  title: string;
  title_long?: string;
  isbn?: string;
  isbn13?: string;
  isbn10?: string;
  publisher?: string;
  language?: string;
  date_published?: string;
  pages?: number;
  image?: string;
  synopsis?: string;
  authors?: string[];
  subjects?: string[];
  other_isbns?: Array<{ isbn: string; binding?: string }>;
}

let lastCallTime = 0;

async function rateLimitedFetch(url: string): Promise<Response | null> {
  const apiKey = process.env.ISBNDB_API_KEY;
  if (!apiKey) return null;

  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < DELAY_MS) {
    await new Promise((r) => setTimeout(r, DELAY_MS - elapsed));
  }
  lastCallTime = Date.now();

  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) {
      if (res.status === 429) console.warn("[isbndb] Rate limited");
      return null;
    }
    return res;
  } catch {
    return null;
  }
}

/**
 * Look up a book by ISBN-13 or ISBN-10.
 */
export async function searchISBNdb(isbn: string): Promise<ISBNdbBook | null> {
  const res = await rateLimitedFetch(`${ISBNDB_BASE}/book/${isbn}`);
  if (!res) return null;

  try {
    const data = await res.json();
    return data.book ?? null;
  } catch {
    return null;
  }
}

/**
 * Search by title + author (fallback when no ISBN available).
 * Returns best match or null.
 */
export async function searchISBNdbByTitle(
  title: string,
  author: string
): Promise<ISBNdbBook | null> {
  const query = encodeURIComponent(`${title} ${author}`.trim());
  const res = await rateLimitedFetch(
    `${ISBNDB_BASE}/books/${query}?pageSize=5&column=title`
  );
  if (!res) return null;

  try {
    const data = await res.json();
    const books: ISBNdbBook[] = data.books ?? [];
    if (books.length === 0) return null;

    // Score matches by title similarity and language
    const titleLower = title.toLowerCase();
    const authorLower = author.toLowerCase();

    let best: ISBNdbBook | null = null;
    let bestScore = -1;

    for (const book of books) {
      let score = 0;
      const bookTitle = (book.title || "").toLowerCase();
      const bookAuthors = (book.authors || []).map((a) => a.toLowerCase());

      // Title match
      if (bookTitle === titleLower) score += 100;
      else if (bookTitle.startsWith(titleLower)) score += 50;
      else if (bookTitle.includes(titleLower)) score += 25;

      // Author match
      if (bookAuthors.some((a) => a.includes(authorLower.split(" ").pop() || ""))) {
        score += 30;
      }

      // Prefer English
      if (book.language === "en") score += 10;

      // Prefer books with covers
      if (book.image) score += 5;

      // Prefer books with pages
      if (book.pages && book.pages > 50) score += 5;

      if (score > bestScore) {
        bestScore = score;
        best = book;
      }
    }

    return bestScore >= 25 ? best : null;
  } catch {
    return null;
  }
}

/**
 * Extract a usable cover URL from ISBNdb result.
 * Returns the standard (non-original) image URL, or null.
 */
export function getISBNdbCoverUrl(book: ISBNdbBook): string | null {
  if (!book.image) return null;
  // ISBNdb image URLs are direct — validate they're not placeholder
  if (book.image.includes("placeholder") || book.image.includes("noimage")) return null;
  return book.image;
}

/**
 * Extract clean description from ISBNdb synopsis (strip HTML tags).
 */
export function getISBNdbDescription(book: ISBNdbBook): string | null {
  if (!book.synopsis) return null;
  // Strip HTML tags
  const clean = book.synopsis
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 20 ? clean : null;
}

/**
 * Extract publication year from ISBNdb date string.
 * Handles formats: "2021-05-04", "2021", "May 2021", etc.
 */
export function getISBNdbYear(book: ISBNdbBook): number | null {
  if (!book.date_published) return null;
  const match = book.date_published.match(/(\d{4})/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  return year >= 1900 && year <= new Date().getFullYear() + 2 ? year : null;
}
