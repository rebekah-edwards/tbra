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
    // Added 2026-05-04 — fourth ISBNdb variant found via /book/permutation-city-c-greg-egan.
    // Tiny 60x40 "No image available" graphic — distinct from the larger 200x248 variants.
    label: "isbndb-v4",
    urlPatternLike: "https://images.isbndb.com/covers/%",
    urlPatternRegex: /^https:\/\/images\.isbndb\.com\/covers\//,
    size: 1304,
    hash: "54664c70cabbc847c9915bb91f7feba9b449b5a9a141e9e1701c080a06dae6c3",
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
  {
    // Added 2026-05-04 — first OpenLibrary placeholder found via /book/the-rat-queen-pete-hautman.
    // OL serves a 60x40 "No image available" graphic for some unmapped IDs.
    // First time we've found a placeholder hosted on covers.openlibrary.org.
    label: "openlibrary-v1",
    urlPatternLike: "https://covers.openlibrary.org/%",
    urlPatternRegex: /^https:\/\/covers\.openlibrary\.org\//,
    size: 1770,
    hash: "1eaa7e0f5efaebddaaa22d54d640e391852271d9dfcb50f67496175c3c8a0ea0",
    sourceField: "openlibrary-placeholder-cleared",
  },
];

/**
 * Hosts where we trust dimension-based detection. We only fetch+measure
 * suspiciously small files (≤ MICRO_IMAGE_BYTE_THRESHOLD) so the bandwidth
 * cost stays low. A "real" book cover thumbnail at 100×150 is typically ≥4 KB
 * — anything below 3 KB at one of these hosts is almost certainly a microimage
 * fallback.
 */
const MICRO_IMAGE_HOST_PATTERNS: { regex: RegExp; sourceField: string }[] = [
  { regex: /^https:\/\/images\.isbndb\.com\/covers\//, sourceField: "isbndb-placeholder-cleared" },
  { regex: /^https:\/\/books\.google\.com\/books\/content/, sourceField: "gbooks-placeholder-cleared" },
  { regex: /^https:\/\/covers\.openlibrary\.org\//, sourceField: "openlibrary-placeholder-cleared" },
];

/** Bytes; HEAD pre-filter — only fetch the body when content-length is below this. */
export const MICRO_IMAGE_BYTE_THRESHOLD = 3000;
/** Pixels; if either side of the JPEG is below this, treat as microimage placeholder. */
export const MICRO_IMAGE_DIMENSION_THRESHOLD = 100;

/**
 * Parse JPEG dimensions from a buffer by walking SOFn markers.
 * Handles baseline (FFC0), extended (FFC1), and progressive (FFC2) JPEGs.
 * Returns null if the buffer is malformed or not a JPEG.
 */
export function parseJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 8) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI

  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];

    // SOF0–SOF15, excluding DHT (C4), JPG (C8), DAC (CC) which are not Start-Of-Frame.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isSof) {
      // Skip 2 (marker) + 2 (length) + 1 (precision); then height (2), width (2).
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }

    // Skip past this segment. SOI/EOI/RSTn are markerless; everything else has length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2) return null;
    i += 2 + segLen;
  }

  return null;
}

/**
 * Match a URL against the dimension-detection host list and return its
 * sourceField if applicable.
 */
function matchMicroImageHost(url: string): string | null {
  for (const host of MICRO_IMAGE_HOST_PATTERNS) {
    if (host.regex.test(url)) return host.sourceField;
  }
  return null;
}

/**
 * Two-tier check:
 *   1. Known fingerprint (size + SHA256 match against the PLACEHOLDERS table).
 *      Iterates ALL fingerprints whose URL pattern matches, since multiple
 *      variants exist per host (e.g. isbndb-v1 through isbndb-v4).
 *   2. Microimage fallback — if the file is suspiciously small and decodes to
 *      < MICRO_IMAGE_DIMENSION_THRESHOLD on either side, treat as placeholder.
 *
 * Returns true if the URL resolves to a placeholder (by either tier).
 * Returns false on network error so callers prefer writing covers we can't
 * verify — the nightly sweep catches stragglers.
 *
 * Important: some hosts (notably covers.openlibrary.org) don't return
 * Content-Length on HEAD requests. We fetch the body and use buf.length as
 * the authoritative size rather than relying on the header.
 */
export async function isKnownPlaceholderCover(url: string, timeoutMs = 5000): Promise<boolean> {
  const matchingFingerprints = PLACEHOLDERS.filter((p) => p.urlPatternRegex.test(url));
  const microHost = matchMicroImageHost(url);
  if (matchingFingerprints.length === 0 && !microHost) return false;

  try {
    // HEAD first as a cheap pre-filter. If we get a definitive Content-Length
    // that's larger than any plausible placeholder AND no fingerprint matches
    // that exact size, we can short-circuit without fetching the body.
    const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    if (!head.ok) return false;
    const headerLen = Number(head.headers.get("content-length"));
    const knownSizes = new Set<number>(matchingFingerprints.map((p) => p.size));

    if (Number.isFinite(headerLen) && headerLen > 0) {
      const isMicroCandidate = headerLen <= MICRO_IMAGE_BYTE_THRESHOLD;
      const isFingerprintCandidate = knownSizes.has(headerLen);
      if (!isMicroCandidate && !isFingerprintCandidate) {
        // Definitively NOT a placeholder — too big for microimage detection
        // and doesn't match any fingerprint size.
        return false;
      }
    }
    // If headerLen is missing/zero/NaN, we can't pre-filter — fall through to
    // body fetch and decide from buf.length.

    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());

    // Tier 1: check against every fingerprint variant for this host
    for (const fp of matchingFingerprints) {
      if (buf.length !== fp.size) continue;
      const hash = createHash("sha256").update(buf).digest("hex");
      if (hash === fp.hash) return true;
    }

    // Tier 2: microimage fallback — small file with tiny dimensions
    if (microHost && buf.length > 0 && buf.length <= MICRO_IMAGE_BYTE_THRESHOLD) {
      const dims = parseJpegDimensions(buf);
      if (dims && (dims.width < MICRO_IMAGE_DIMENSION_THRESHOLD || dims.height < MICRO_IMAGE_DIMENSION_THRESHOLD)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * For a given URL that's already been confirmed-as-placeholder, return the
 * appropriate `cover_source` value to set when clearing it. Used by
 * cover-rescue.ts when reporting the kind of clear that happened.
 */
export function placeholderSourceFieldFor(url: string): string | null {
  const fp = PLACEHOLDERS.find((p) => p.urlPatternRegex.test(url));
  if (fp) return fp.sourceField;
  return matchMicroImageHost(url);
}
