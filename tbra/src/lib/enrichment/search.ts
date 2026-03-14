import type { BraveResult } from "./types";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

export async function braveSearch(
  query: string,
  count = 10
): Promise<BraveResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.warn("[enrichment] BRAVE_SEARCH_API_KEY not set, skipping search");
    return [];
  }

  const url = new URL(BRAVE_API_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    console.error(`[enrichment] Brave search failed: ${res.status} ${res.statusText}`);
    return [];
  }

  const data = await res.json();
  const results = data.web?.results ?? [];

  return results.map((r: { title: string; url: string; description: string }) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}
