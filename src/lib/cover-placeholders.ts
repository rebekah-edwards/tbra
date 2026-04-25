/**
 * Shared fingerprints + detector for known "no cover available" placeholders.
 * Used by enrich-book.ts (reject at write time) and scripts/cover-rescue.ts
 * (nightly sweep of already-written placeholders).
 */
import { createHash } from "crypto";

export interface PlaceholderFingerprint {
  label: string;
  urlPatternLike: string;       // SQL LIKE for cover-rescue
  urlPatternRegex: RegExp;      // runtime check
  size: number;
  hash: string;
  sourceField: string;          // what cover_source gets set to on clear
}

export const PLACEHOLDERS: PlaceholderFingerprint[] = [
  {
    label: "isbndb-v1",
    urlPatternLike: "https://images.isbndb.com/covers/%",
    urlPatternRegex: /^https:\/\/images\.isbndb\.com\/covers\//,
    size: 3736,
    hash: "56c3e12f87260f78db39b9deeb0d04194e110c99702e6483963f2ab009bfea15",
    sourceField: "isbndb-placeholder-cleared",
  },
  {
    // Added 2026-04-20 — second ISBNdb "no cover" variant found via
    // /book/the-ending-writes-itself. Same hostname as v1 but a different
    // placeholder image (12008 bytes, 350x500 px progressive JPEG).
    label: "isbndb-v2",
    urlPatternLike: "https://images.isbndb.com/covers/%",
    urlPatternRegex: /^https:\/\/images\.isbndb\.com\/covers\//,
    size: 12008,
    hash: "a5f722c897cdc916e8bde0dd045d56bc29e78400871c61479e6a6493f1fe0f49",
    sourceField: "isbndb-placeholder-cleared",
  },
  {
    // Added 2026-04-24 — third ISBNdb "no cover" variant found via
    // /book/first-team-scott-brick. Backlog cleanup turned up 45 books
    // serving this fingerprint.
    label: "isbndb-v3",
    urlPatternLike: "https://images.isbndb.com/covers/%",
    urlPatternRegex: /^https:\/\/images\.isbndb\.com\/covers\//,
    size: 4176,
    hash: "32d36985a98a6cb4b337ee2b3088d4bcd970a00251a32ac074d8f9a287b9958a",
    sourceField: "isbndb-placeholder-cleared",
  },
  {
    label: "google-books",
    urlPatternLike: "https://books.google.com/books/content%",
    urlPatternRegex: /^https:\/\/books\.google\.com\/books\/content/,
    size: 15567,
    hash: "12557f8948b8bdc6af436e3a8b3adddd45f7f7d2b67c5832e799cdf4686f72bb",
    sourceField: "gbooks-placeholder-cleared",
  },
  {
    // Added 2026-04-25 — second Google Books "no cover" variant found via
    // /book/football-larry-niven (the user's repeatedly-reverted cover).
    // Tiny 1026-byte placeholder served when Google Books has metadata but
    // no actual cover image.
    label: "google-books-v2",
    urlPatternLike: "https://books.google.com/books/content%",
    urlPatternRegex: /^https:\/\/books\.google\.com\/books\/content/,
    size: 1026,
    hash: "b196a07e5b2e4ec0bab6b7859a82f4ca58a9fbf781f526f99dc69ee02b400de7",
    sourceField: "gbooks-placeholder-cleared",
  },
];

/** Returns true when the URL resolves to a known placeholder image.
 *  Returns false on network error — callers should prefer writing the cover
 *  over rejecting it when we can't decide. The nightly sweep catches stragglers.
 */
export async function isKnownPlaceholderCover(url: string, timeoutMs = 5000): Promise<boolean> {
  const candidate = PLACEHOLDERS.find((p) => p.urlPatternRegex.test(url));
  if (!candidate) return false;

  try {
    const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    if (!head.ok) return false;
    const len = Number(head.headers.get("content-length"));
    if (!Number.isFinite(len) || len !== candidate.size) return false;

    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== candidate.size) return false;
    const hash = createHash("sha256").update(buf).digest("hex");
    return hash === candidate.hash;
  } catch {
    return false;
  }
}
