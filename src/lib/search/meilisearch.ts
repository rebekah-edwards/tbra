import { Meilisearch } from "meilisearch";
import type { SearchResult } from "./search-provider";
import { stripStopWords, tokenizeQuery } from "./relevance";

let client: Meilisearch | null = null;

function getClient(): Meilisearch {
  if (!client) {
    const host = process.env.MEILISEARCH_HOST;
    const apiKey = process.env.MEILISEARCH_SEARCH_KEY;
    if (!host || !apiKey) {
      throw new Error("MEILISEARCH_HOST and MEILISEARCH_SEARCH_KEY must be set");
    }
    client = new Meilisearch({ host, apiKey });
  }
  return client;
}

/**
 * Pick a matching strategy based on the query shape.
 *
 * Single discriminating token ("malice") → "last" (the default Meilisearch
 *   behavior, which progressively drops words from the end but requires the
 *   first to match). Safer than "all" for one-word queries because it still
 *   allows typo tolerance.
 *
 * Multiple discriminating tokens ("god of malice", "mistborn era 2") → "all".
 *   We want every meaningful term to be present. The route-level post-filter
 *   in relevance.ts catches anything that slips through typo tolerance.
 */
function pickStrategy(query: string): "all" | "last" | "frequency" {
  const { discriminating } = tokenizeQuery(query);
  return discriminating.length >= 2 ? "all" : "last";
}

/**
 * Search books via Meilisearch Cloud.
 * Returns book IDs ranked by relevance (typo-tolerant, prefix-matching).
 *
 * For multi-word queries, uses `matchingStrategy: "all"` and strips
 * stopwords so "god of malice" becomes "god malice" and Meilisearch
 * requires BOTH tokens — instead of returning everything that happens
 * to contain "malice".
 */
export async function searchBooksMeilisearch(
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  const index = getClient().index("books");
  const effectiveQuery = stripStopWords(query);

  // Space-tolerance: "Heaven breaker" can never match the single indexed
  // token "Heavenbreaker" under matchingStrategy "all" (each word must match
  // separately, and Meilisearch has no split/concat handling configured).
  // For short multi-word queries, ALSO search the concatenated form and
  // merge, concatenated hits first-class (found 2026-07-15).
  const tokens = effectiveQuery.split(/\s+/).filter(Boolean);
  const concatenated = tokens.length >= 2 && tokens.length <= 3 && effectiveQuery.length <= 30
    ? tokens.join("")
    : null;

  const [results, concatResults] = await Promise.all([
    index.search(effectiveQuery, {
      limit,
      attributesToRetrieve: ["id"],
      matchingStrategy: pickStrategy(query),
    }),
    concatenated
      ? index.search(concatenated, {
          limit: 5,
          attributesToRetrieve: ["id"],
          matchingStrategy: "last",
        })
      : Promise.resolve(null),
  ]);

  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  // Concatenated exact-ish hits rank ABOVE the split-token hits: if someone
  // typed the split form of a one-word title, that title is the best answer.
  for (const hit of concatResults?.hits ?? []) {
    const id = hit.id as string;
    if (!seen.has(id)) { seen.add(id); merged.push({ bookId: id, rank: -(limit + 5 - merged.length) }); }
  }
  for (const hit of results.hits) {
    const id = hit.id as string;
    if (!seen.has(id)) { seen.add(id); merged.push({ bookId: id, rank: -(limit - merged.length) }); }
  }
  return merged.slice(0, limit);
}

/**
 * Search series via Meilisearch Cloud.
 */
export async function searchSeriesMeilisearch(
  query: string,
  limit = 10,
): Promise<{ id: string; name: string; bookCount: number }[]> {
  const index = getClient().index("series");
  const effectiveQuery = stripStopWords(query);
  const results = await index.search(effectiveQuery, {
    limit,
    attributesToRetrieve: ["id", "name", "bookCount"],
    matchingStrategy: pickStrategy(query),
  });

  return results.hits.map((hit) => ({
    id: hit.id as string,
    name: hit.name as string,
    bookCount: (hit.bookCount as number) ?? 0,
  }));
}

/**
 * Search authors via Meilisearch Cloud.
 */
export async function searchAuthorsMeilisearch(
  query: string,
  limit = 10,
): Promise<{ id: string; name: string; bookCount: number }[]> {
  const index = getClient().index("authors");
  const effectiveQuery = stripStopWords(query);
  const results = await index.search(effectiveQuery, {
    limit,
    attributesToRetrieve: ["id", "name", "bookCount"],
    matchingStrategy: pickStrategy(query),
  });

  return results.hits.map((hit) => ({
    id: hit.id as string,
    name: hit.name as string,
    bookCount: (hit.bookCount as number) ?? 0,
  }));
}
