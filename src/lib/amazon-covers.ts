/**
 * Amazon cover image resolution helpers.
 *
 * Amazon product images are publicly accessible via a predictable CDN URL
 * when you know the ASIN. No API key required.
 *
 * Cover URL format:
 *   https://m.media-amazon.com/images/P/{ASIN}.01._SL500_.jpg
 *
 * Size suffixes (SL = square-longest-side):
 *   _SL160_  → thumbnail (~160px)
 *   _SL500_  → medium (~500px)  ← default
 *   _SL1500_ → large (~1500px)
 *
 * The URL is validated with a HEAD request before returning.
 */

const AMAZON_CDN = "https://m.media-amazon.com/images/P";

type AmazonCoverSize = "thumbnail" | "medium" | "large";

const SIZE_SUFFIX: Record<AmazonCoverSize, string> = {
  thumbnail: "_SL160_",
  medium: "_SL500_",
  large: "_SL1500_",
};

/**
 * Build a candidate Amazon cover URL from an ASIN.
 */
export function buildAmazonCoverUrl(asin: string, size: AmazonCoverSize = "medium"): string {
  const suffix = SIZE_SUFFIX[size];
  return `${AMAZON_CDN}/${asin}.01.${suffix}.jpg`;
}

/**
 * Attempt to extract an ASIN from an Amazon product URL.
 * Handles /dp/, /gp/product/, and /ASIN/ path forms.
 */
export function extractAsinFromUrl(url: string): string | null {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/([A-Z0-9]{10})(?:\/|\?|$)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m?.[1]) return m[1].toUpperCase();
  }
  return null;
}

/**
 * Validate a URL is reachable via HEAD request.
 */
async function headCheck(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Find an Amazon cover image for a book.
 *
 * Tries in order:
 *  1. `asin` field from the books table
 *  2. Any Amazon link in the links table (passed in as optional param)
 *
 * Returns a validated cover URL (medium size) or null.
 */
export async function findAmazonCover(params: {
  asin?: string | null;
  /** Amazon product page URLs from the links table */
  amazonLinkUrls?: string[];
}): Promise<string | null> {
  const candidates: string[] = [];

  // Collect ASINs to try
  const asinsToTry = new Set<string>();

  if (params.asin) {
    asinsToTry.add(params.asin.toUpperCase());
  }

  for (const url of params.amazonLinkUrls ?? []) {
    const asin = extractAsinFromUrl(url);
    if (asin) asinsToTry.add(asin);
  }

  for (const asin of asinsToTry) {
    candidates.push(buildAmazonCoverUrl(asin, "medium"));
  }

  for (const url of candidates) {
    const ok = await headCheck(url);
    if (ok) return url;
  }

  return null;
}
