/**
 * Search provider interface — abstracts the search backend so we can swap
 * between Meilisearch (current), FTS5 (local dev), LIKE (Turso fallback),
 * or Amazon Creators API (future) via env var.
 */

export interface SearchResult {
  bookId: string;
  rank: number;
}

export interface SearchProvider {
  searchBooks(query: string, limit: number): Promise<SearchResult[]>;
}

/**
 * Get the active search provider based on environment config.
 * Falls back gracefully: Meilisearch → FTS5 → LIKE
 */
export function getSearchProvider(): "meilisearch" | "fts5" | "like" {
  if (process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_SEARCH_KEY) {
    return "meilisearch";
  }
  // FTS5 and LIKE are handled internally by searchBooksFTS
  return "fts5";
}
