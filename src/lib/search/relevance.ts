/**
 * Shared query-relevance helpers for book/series/author search.
 *
 * The core rule: when a user types multiple words, they almost always
 * mean "show me things that match ALL of them". A search for "god of
 * malice" should NOT return "Music and Malice in Hurricane Town" just
 * because one token happens to match.
 *
 * We implement this in two layers:
 *   1. `matchingStrategy: "all"` on Meilisearch (handled in meilisearch.ts)
 *   2. A post-filter here that enforces the rule regardless of backend
 *      (Meilisearch typo tolerance, FTS5 prefix matching, LIKE fallback,
 *      ISBNdb external — all get filtered the same way)
 */

// Words we strip from "must match all tokens" — they're too common to be
// discriminating and would filter out legitimate matches. Kept short
// because we want the rule to stay strict on meaningful terms.
export const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "in", "on", "at", "to", "for", "by",
  "is", "it", "its", "be", "or", "as", "from", "with", "about",
]);

/** Normalize a string for token-match comparisons (lowercase, unicode-safe). */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // Replace punctuation with spaces so "Percy Jackson & the Olympians"
    // tokenizes cleanly and "It's" / "its" match.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Split a query into all tokens vs. discriminating tokens.
 * - all:            every non-empty lowercase token
 * - discriminating: all minus STOP_WORDS. These are the tokens we require
 *                   to appear in every result when the query has ≥2 of them.
 */
export function tokenizeQuery(query: string): { all: string[]; discriminating: string[] } {
  const normalized = normalizeForMatch(query);
  const all = normalized.split(/\s+/).filter(Boolean);
  const discriminating = all.filter((t) => !STOP_WORDS.has(t));
  return { all, discriminating };
}

/**
 * True if `combined` (already-lowercased title + authors + series text)
 * contains every discriminating token. Single-word queries always pass
 * (the Meilisearch/FTS layer already did the matching).
 *
 * If the query is ENTIRELY stopwords (e.g. "the of and"), also passes —
 * there's nothing discriminating to check.
 */
export function matchesAllDiscriminatingTokens(
  combined: string,
  discriminatingTokens: string[],
): boolean {
  if (discriminatingTokens.length <= 1) return true;
  const combinedLower = combined.toLowerCase();
  for (const token of discriminatingTokens) {
    if (!combinedLower.includes(token)) return false;
  }
  return true;
}

/**
 * Count how many discriminating tokens appear in `combined`. Used as a
 * ranking signal when interleaving local + external results (higher = more
 * relevant to the user's intent).
 */
export function countTokenMatches(
  combined: string,
  discriminatingTokens: string[],
): number {
  if (discriminatingTokens.length === 0) return 0;
  const combinedLower = combined.toLowerCase();
  let n = 0;
  for (const token of discriminatingTokens) {
    if (combinedLower.includes(token)) n++;
  }
  return n;
}

/**
 * Strip stopwords from a query string. Used when passing queries to
 * Meilisearch with `matchingStrategy: "all"` — otherwise "the" and "of"
 * would become required terms and filter out legit matches.
 *
 * Returns the original query if every token is a stopword (so we don't
 * send an empty string to Meilisearch).
 */
export function stripStopWords(query: string): string {
  const { all, discriminating } = tokenizeQuery(query);
  if (discriminating.length === 0) return query;
  if (discriminating.length === all.length) return query;
  return discriminating.join(" ");
}
