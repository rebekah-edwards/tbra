/**
 * Google Books API integration for cover images and metadata fallback.
 *
 * Used when Open Library doesn't have cover art for a book.
 */

import { consumeApiQuotaShared } from "@/lib/api-quota";

const GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes";

/**
 * Google Books allows 1,000 queries/day on the free tier (resets midnight
 * Pacific), and that allowance is spent by THREE consumers at once:
 * `upcoming-releases`, the enrichment cover cascade, and the description tier.
 * Left ungoverned they race to exhaustion — the error log showed daily 429s on
 * 7 of 8 days in Aug 2026 — and every lane reads the resulting 503 as an
 * upstream outage rather than "someone else spent your budget".
 *
 * So every call goes through ONE shared counter. Default 950 leaves ~50 for
 * ad-hoc/manual runs. Raise `GOOGLE_BOOKS_DAILY_MAX` the moment the project's
 * Cloud Console quota is raised — that env var is the only change needed.
 */
const GOOGLE_BOOKS_DAILY_MAX = Number(process.env.GOOGLE_BOOKS_DAILY_MAX) || 950;

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
 *
 * `orderBy` defaults to Google's relevance ranking; pass "newest" to surface
 * the most recently published (and forthcoming) editions first — this is the
 * lever the upcoming-releases lane uses to find an author's next book.
 */
export async function searchGoogleBooks(
  query: string,
  maxResults = 5,
  orderBy: "relevance" | "newest" = "relevance"
): Promise<GoogleBooksVolume[]> {
  return (await searchGoogleBooksDetailed(query, maxResults, orderBy)).volumes;
}

/**
 * Result of a Google Books call that distinguishes "the API answered and there
 * were no matches" from "the call never landed".
 *
 * `searchGoogleBooks` collapses both into `[]`, which is fine for enrichment
 * (a miss and a failure are both "no data") but WRONG for any caller that
 * advances a cursor on the assumption an author was actually checked — a
 * quota-exhausted night would silently burn cursor slots. Callers that rotate
 * through a work list should use this and re-queue anything with `ok:false`.
 */
export type GoogleBooksSearchResult = {
  ok: boolean;
  /** HTTP status, or null when the request threw / no key was configured. */
  status: number | null;
  /** True when the failure is a daily-quota exhaustion (429, or the 503 the API returns once the Queries-per-day limit is spent). */
  quotaExhausted: boolean;
  volumes: GoogleBooksVolume[];
};

export async function searchGoogleBooksDetailed(
  query: string,
  maxResults = 5,
  orderBy: "relevance" | "newest" = "relevance"
): Promise<GoogleBooksSearchResult> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) {
    console.warn("[google-books] No GOOGLE_BOOKS_API_KEY set");
    return { ok: false, status: null, quotaExhausted: false, volumes: [] };
  }

  // Budget check BEFORE the request. Reported as `quotaExhausted` because that
  // is exactly what it means to the caller — the daily allowance is gone — and
  // every existing caller already handles that state correctly (defer + retry
  // tomorrow) rather than treating it as a hard failure.
  // "pacific" because Google's Queries-per-day resets at midnight Pacific, not UTC.
  const budget = await consumeApiQuotaShared("google_books", GOOGLE_BOOKS_DAILY_MAX, "pacific");
  if (!budget.ok) {
    console.warn(
      `[google-books] daily budget reached (${budget.dailyCount}/${GOOGLE_BOOKS_DAILY_MAX}) — skipping "${query}"`,
    );
    return { ok: false, status: null, quotaExhausted: true, volumes: [] };
  }

  const url = new URL(GOOGLE_BOOKS_API);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  if (orderBy === "newest") url.searchParams.set("orderBy", "newest");
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
      // The Queries-per-day limit surfaces as 429 on a direct probe but as 503
      // through this endpoint once the project's daily quota is spent, so treat
      // both as exhaustion rather than as a transient outage.
      return {
        ok: false,
        status: res.status,
        quotaExhausted: res.status === 429 || res.status === 503,
        volumes: [],
      };
    }
    const data = await res.json();
    return {
      ok: true,
      status: res.status,
      quotaExhausted: false,
      volumes: (data.items ?? []) as GoogleBooksVolume[],
    };
  } catch (err) {
    console.error("[google-books] Search failed:", err);
    return { ok: false, status: null, quotaExhausted: false, volumes: [] };
  }
}

/**
 * Search by ISBN specifically (more reliable).
 */
export async function searchGoogleBooksByIsbn(isbn: string): Promise<GoogleBooksVolume[]> {
  return searchGoogleBooks(`isbn:${isbn}`, 3);
}

/**
 * Best-effort publisher description for a book, from Google Books.
 *
 * This is the tier the pipeline was missing: OL and ISBNdb both go quiet on the
 * long tail, and before this the only remaining source was the Brave+Grok pass
 * at ~36s and ~5 Brave calls per book. Measured against the 40 oldest
 * stale-flagged books (the hardest cases in the catalog, all of which had
 * already failed OL and ISBNdb repeatedly), this returned a usable description
 * for 25% of them at ~0.5s each.
 *
 * ISBN-13 → ISBN-10 → title+author, stopping at the first hit, so a book with
 * an ISBN costs exactly one call. The title+author fallback is deliberately
 * last and strict about the author matching: `q=` free text will happily return
 * a different book by the same name, and a confidently-wrong description is
 * worse than none — that is the failure mode Rebekah is already seeing in the
 * catalog.
 *
 * Returns raw text; the CALLER must run it through `sanitizeDescription`.
 */
export async function fetchGoogleBooksDescription(opts: {
  isbn13?: string | null;
  isbn10?: string | null;
  title: string;
  author?: string | null;
}): Promise<{ description: string | null; quotaExhausted: boolean }> {
  const attempts: string[] = [];
  if (opts.isbn13) attempts.push(`isbn:${opts.isbn13}`);
  if (opts.isbn10) attempts.push(`isbn:${opts.isbn10}`);

  for (const q of attempts) {
    const res = await searchGoogleBooksDetailed(q, 3);
    if (res.quotaExhausted) return { description: null, quotaExhausted: true };
    const hit = res.volumes.find((v) => (v.volumeInfo.description ?? "").length >= 80);
    if (hit) return { description: hit.volumeInfo.description!, quotaExhausted: false };
  }

  // No ISBN, or the ISBN lookups came back empty. Fall back to title+author,
  // but only accept a volume whose title AND author both corroborate — an
  // unverified match here is how wrong-book descriptions get written.
  if (!opts.author) return { description: null, quotaExhausted: false };

  const res = await searchGoogleBooksDetailed(
    `intitle:"${opts.title}" inauthor:"${opts.author}"`,
    5,
  );
  if (res.quotaExhausted) return { description: null, quotaExhausted: true };

  const wantTitle = normalizeForMatch(opts.title);
  const wantAuthor = normalizeForMatch(opts.author);
  for (const v of res.volumes) {
    const desc = v.volumeInfo.description ?? "";
    if (desc.length < 80) continue;
    const gotTitle = normalizeForMatch(v.volumeInfo.title ?? "");
    const authorsOk = (v.volumeInfo.authors ?? []).some((a) => {
      const got = normalizeForMatch(a);
      return got === wantAuthor || got.includes(wantAuthor) || wantAuthor.includes(got);
    });
    const titleOk = gotTitle === wantTitle || gotTitle.startsWith(wantTitle) || wantTitle.startsWith(gotTitle);
    if (authorsOk && titleOk) return { description: desc, quotaExhausted: false };
  }
  return { description: null, quotaExhausted: false };
}

/** Lowercase, strip punctuation/subtitles/articles so title+author compare sanely. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .split(":")[0]
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch an author's most-recent / forthcoming volumes, newest first.
 *
 * Used by the upcoming-releases lane: query by exact author, ordered newest,
 * so the caller can keep only the volumes whose published date is in the
 * future. Returns the raw volumes (the caller does date parsing + dedup).
 */
export async function searchGoogleBooksByAuthorNewest(
  authorName: string,
  maxResults = 12
): Promise<GoogleBooksVolume[]> {
  // inauthor: with quotes pins the match to the full author name rather than
  // matching either token loosely.
  return searchGoogleBooks(`inauthor:"${authorName}"`, maxResults, "newest");
}

/**
 * Same query as `searchGoogleBooksByAuthorNewest`, but reports whether the call
 * actually landed. The upcoming-releases lane uses this so an author whose
 * query died on quota is re-queued instead of being marked as checked.
 */
export async function searchGoogleBooksByAuthorNewestDetailed(
  authorName: string,
  maxResults = 12
): Promise<GoogleBooksSearchResult> {
  return searchGoogleBooksDetailed(`inauthor:"${authorName}"`, maxResults, "newest");
}

/**
 * Pull the best ISBN-13 / ISBN-10 out of a volume's industryIdentifiers.
 */
export function getGoogleBooksIsbns(volume: GoogleBooksVolume): {
  isbn13: string | null;
  isbn10: string | null;
} {
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  for (const idf of volume.volumeInfo.industryIdentifiers ?? []) {
    if (idf.type === "ISBN_13" && !isbn13) isbn13 = idf.identifier.replace(/[^0-9]/g, "");
    if (idf.type === "ISBN_10" && !isbn10) isbn10 = idf.identifier.replace(/[^0-9Xx]/g, "").toUpperCase();
  }
  return { isbn13, isbn10 };
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
