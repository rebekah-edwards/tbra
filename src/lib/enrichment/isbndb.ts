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
 * General-purpose ISBNdb search. Returns up to `limit` books matching the query.
 * Unlike searchISBNdbByTitle which scores and picks the single best match,
 * this returns the raw list — suitable for search UI result lists.
 *
 * Each call consumes ONE ISBNdb quota unit. Caller is responsible for
 * quota enforcement via consumeApiQuota().
 */
export async function searchISBNdbMulti(
  query: string,
  limit = 10,
): Promise<ISBNdbBook[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const res = await rateLimitedFetch(
    `${ISBNDB_BASE}/books/${encodeURIComponent(trimmed)}?pageSize=${limit}`
  );
  if (!res) return [];

  try {
    const data = await res.json();
    const books: ISBNdbBook[] = data.books ?? [];
    // Filter: require title + at least one ISBN so we can import later
    return books.filter((b) => {
      if (!b.title) return false;
      if (!b.isbn13 && !b.isbn10 && !b.isbn) return false;
      // Skip placeholder/test entries
      if (b.title.toLowerCase().includes("placeholder")) return false;
      return true;
    });
  } catch {
    return [];
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
 * Extract clean description from ISBNdb synopsis.
 * Strips HTML tags, decodes entities, removes Amazon ad snippets,
 * author attribution lines, and other junk.
 */
export function getISBNdbDescription(book: ISBNdbBook): string | null {
  if (!book.synopsis) return null;

  let clean = book.synopsis
    // Strip HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode HTML entities
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    // Remove Amazon ad snippets ("Title" by Author for $X.XX ... | Learn more)
    .replace(/"[^"]+"\s+by\s+[^|]+\|\s*Learn more/gi, "")
    .replace(/From #\d+.*?bestselling author.*?(?=\.|$)/gi, "")
    // Remove author attribution lines (starts with "by Author (Author), Illustrator...")
    .replace(/^by\s+[A-Z][\w\s,()&]+(?:Author|Illustrator|Editor|Translator|Contributor|more)\s*/i, "")
    .replace(/\(Author\)|\(Illustrator\)|\(Editor\)|\(Translator\)/gi, "")
    // Remove "& N more" patterns
    .replace(/&\s*\d+\s*more/gi, "")
    // Remove price patterns
    .replace(/\$\d+\.\d{2}/g, "")
    // Remove "Learn more" / "Read more" links
    .replace(/\|\s*Learn more/gi, "")
    .replace(/Read more\s*$/gi, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  // Remove leading/trailing fragments that look like junk
  clean = clean.replace(/^[\s.,;:|]+/, "").replace(/[\s.,;:|]+$/, "").trim();

  // Reject author bios masquerading as descriptions
  if (/^(?:but )?during his|^he (?:has had|is the author)|^she (?:has had|is the author)|^born in/i.test(clean)) return null;

  // Reject Amazon product page text
  if (/^Amazon\.com:|^\d{10,13}:|: Books$/i.test(clean)) return null;

  // Reject if it still contains HTML tags after stripping
  if (/<strong>|<em>|<br>/i.test(clean)) return null;

  // Cap at 2000 chars — anything longer is likely a full book contents dump
  if (clean.length > 2000) clean = clean.slice(0, 2000).replace(/\s\S*$/, "...");

  // Must be substantial content
  return clean.length > 40 ? clean : null;
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
