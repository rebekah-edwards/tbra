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
  const results = await index.search(effectiveQuery, {
    limit,
    attributesToRetrieve: ["id"],
    matchingStrategy: pickStrategy(query),
  });

  return results.hits.map((hit, i) => ({
    bookId: hit.id as string,
    // Meilisearch returns results in relevance order; assign synthetic rank
    rank: -(limit - i),
  }));
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
