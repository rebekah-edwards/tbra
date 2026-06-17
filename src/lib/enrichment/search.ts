import type { BraveResult } from "./types";
import { consumeApiQuotaWithMonthly } from "../api-quota";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

// Brave budget caps. Default monthly cap is 101,000 calls = $505/mo at
// $5 per 1,000 calls; daily cap smooths spend (~3,300/day ≈ 660 books @ 5
// calls/book). Both overridable via env so the budget can be tuned without a
// code change. This is the HARD backstop that lets us safely default Brave ON:
// when either cap is hit, braveSearch throws API_EXHAUSTED, which aborts the
// book's enrichment BEFORE thin ratings are written and pauses the pipeline —
// the same safe path as a 429/invalid-key, never a silent overspend.
const BRAVE_DAILY_MAX = Number(process.env.BRAVE_DAILY_MAX) || 3300;
const BRAVE_MONTHLY_MAX = Number(process.env.BRAVE_MONTHLY_MAX) || 101000;

export async function braveSearch(
  query: string,
  count = 10
): Promise<BraveResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.warn("[enrichment] BRAVE_SEARCH_API_KEY not set, skipping search");
    return [];
  }

  // Budget guard — single choke point for every Brave call in the pipeline.
  const budget = await consumeApiQuotaWithMonthly("brave_search", BRAVE_DAILY_MAX, BRAVE_MONTHLY_MAX);
  if (!budget.ok) {
    const err = new Error(
      `Brave budget reached (${budget.reason} cap: ${budget.reason === "monthly" ? budget.monthlyCount : budget.dailyCount}) — pausing to stay within the $505/mo cap`,
    );
    (err as Error & { code: string }).code = "API_EXHAUSTED";
    throw err;
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
    const status = res.status;
    // Read the error body so an auth failure (invalid/expired key) is not
    // mistaken for an empty result set.
    let bodyCode = "";
    try {
      const body = await res.json();
      bodyCode = body?.error?.code ?? "";
    } catch { /* non-JSON body */ }

    console.error(`[enrichment] Brave search failed: ${status} ${res.statusText}${bodyCode ? ` (${bodyCode})` : ""}`);

    // FAIL LOUD on authentication failures. Brave returns 422
    // SUBSCRIPTION_TOKEN_INVALID (and 401) when the key is invalid/expired.
    // Returning [] here would silently strip web research from content analysis,
    // baking thin/inaccurate ratings into books with no visible error. Routing it
    // through API_EXHAUSTED instead aborts enrichment BEFORE ratings are written,
    // logs api_exhausted, emails the admin, and pauses — so books stay pending and
    // self-heal once a valid key is restored.
    if (status === 401 || bodyCode === "SUBSCRIPTION_TOKEN_INVALID") {
      const err = new Error(`Brave API key invalid (${status} ${bodyCode || "auth"}) — set a valid BRAVE_SEARCH_API_KEY`);
      (err as Error & { code: string }).code = "API_EXHAUSTED";
      throw err;
    }
    // 429 = rate limited, 403 = quota exhausted
    if (status === 429 || status === 403) {
      const err = new Error(`Brave API exhausted (${status})`);
      (err as Error & { code: string }).code = "API_EXHAUSTED";
      throw err;
    }
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
