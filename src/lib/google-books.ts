/**
 * Google Books API integration for cover images and metadata fallback.
 *
 * Used when Open Library doesn't have cover art for a book.
 */

const GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes";

export interface GoogleBooksVolume {
  id: string;
  volumeInfo: {
    title: string;
    authors?: string[];
    description?: string;
    publishedDate?: string;
    pageCount?: number;
    imageLinks?: {
      smallThumbnail?: string;
      thumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
      extraLarge?: string;
    };
    industryIdentifiers?: {
      type: string; // "ISBN_10" | "ISBN_13" | "OTHER"
      identifier: string;
    }[];
  };
}

/**
 * Search Google Books by title + author, or by ISBN.
 */
export async function searchGoogleBooks(
  query: string,
  maxResults = 5
): Promise<GoogleBooksVolume[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) {
    console.warn("[google-books] No GOOGLE_BOOKS_API_KEY set");
    return [];
  }

  const url = new URL(GOOGLE_BOOKS_API);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`[google-books] API error: ${res.status} ${res.statusText}`);
      // Log 429s to a reviewable file
      if (res.status === 429) {
        try {
          const fs = await import("fs/promises");
          const logLine = `${new Date().toISOString()}\t429\t${query}\n`;
          await fs.appendFile("/tmp/tbra-google-books-errors.log", logLine);
        } catch { /* ignore fs errors */ }
      }
      return [];
    }
    const data = await res.json();
    return (data.items ?? []) as GoogleBooksVolume[];
  } catch (err) {
    console.error("[google-books] Search failed:", err);
    return [];
  }
}

/**
 * Search by ISBN specifically (more reliable).
 */
export async function searchGoogleBooksByIsbn(isbn: string): Promise<GoogleBooksVolume[]> {
  return searchGoogleBooks(`isbn:${isbn}`, 3);
}

/**
 * Get the best cover URL from a Google Books volume.
 * Prefers larger sizes, upgrades to zoom=1 for better quality.
 */
export function getGoogleBooksCoverUrl(volume: GoogleBooksVolume): string | null {
  const links = volume.volumeInfo.imageLinks;
  if (!links) return null;

  // Prefer larger sizes
  const url =
    links.extraLarge ??
    links.large ??
    links.medium ??
    links.small ??
    links.thumbnail ??
    links.smallThumbnail;

  if (!url) return null;

  // Google Books URLs use http by default — upgrade to https
  // Also set zoom=1 for better quality if not already set
  let cleanUrl = url.replace(/^http:/, "https:");
  if (!cleanUrl.includes("zoom=")) {
    cleanUrl += "&zoom=1";
  }

  return cleanUrl;
}

/**
 * Try to find a cover image for a book using Google Books.
 * Tries ISBN first (most reliable), then title+author search.
 */
export async function findGoogleBooksCover(params: {
  title: string;
  authors?: string[];
  isbn13?: string | null;
  isbn10?: string | null;
  asin?: string | null;
}): Promise<string | null> {
  const { title, authors, isbn13, isbn10 } = params;

  // 1. Try ISBN lookup first (most reliable)
  if (isbn13) {
    const results = await searchGoogleBooksByIsbn(isbn13);
    for (const vol of results) {
      const cover = getGoogleBooksCoverUrl(vol);
      if (cover) return cover;
    }
  }

  if (isbn10) {
    const results = await searchGoogleBooksByIsbn(isbn10);
    for (const vol of results) {
      const cover = getGoogleBooksCoverUrl(vol);
      if (cover) return cover;
    }
  }

  // 2. Fallback to title + author search
  const authorStr = authors?.[0] ?? "";
  const query = authorStr ? `intitle:${title} inauthor:${authorStr}` : `intitle:${title}`;
  const results = await searchGoogleBooks(query, 5);

  // Find the best match by comparing titles
  const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  for (const vol of results) {
    const volTitle = vol.volumeInfo.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    // Require reasonable title match
    if (volTitle.includes(normTitle) || normTitle.includes(volTitle)) {
      const cover = getGoogleBooksCoverUrl(vol);
      if (cover) return cover;
    }
  }

  // If we still have results, just take the first one with a cover
  for (const vol of results) {
    const cover = getGoogleBooksCoverUrl(vol);
    if (cover) return cover;
  }

  return null;
}
