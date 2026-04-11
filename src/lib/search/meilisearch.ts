import { Meilisearch } from "meilisearch";
import type { SearchResult } from "./search-provider";

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
 * Search books via Meilisearch Cloud.
 * Returns book IDs ranked by relevance (typo-tolerant, prefix-matching).
 */
export async function searchBooksMeilisearch(
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  const index = getClient().index("books");
  const results = await index.search(query, {
    limit,
    attributesToRetrieve: ["id"],
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
  const results = await index.search(query, {
    limit,
    attributesToRetrieve: ["id", "name", "bookCount"],
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
  const results = await index.search(query, {
    limit,
    attributesToRetrieve: ["id", "name", "bookCount"],
  });

  return results.hits.map((hit) => ({
    id: hit.id as string,
    name: hit.name as string,
    bookCount: (hit.bookCount as number) ?? 0,
  }));
}
