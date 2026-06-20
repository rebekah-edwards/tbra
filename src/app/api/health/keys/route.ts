import { NextResponse } from "next/server";

// Don't cache — this must reflect the live state of production env vars.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/health/keys
 *
 * Server-side health check for the external API keys the enrichment pipeline
 * depends on, exercised with the ACTUAL production runtime env vars. This is the
 * only reliable way to detect key drift: `vercel env pull` can't read Sensitive
 * vars (they decrypt to empty), and a local `.env.local` check tells you nothing
 * about what production is running — the exact gap that let an invalid Brave key
 * sit in production for ~89 days, silently breaking all new-import enrichment.
 *
 * The nightly key-health canary (scripts/check-api-keys.ts) curls this and files
 * an /admin/issues alert when a critical provider is down.
 *
 * Auth: x-enrichment-secret header or ?secret= query param (the canary runs
 * headless). Each provider is tested with the cheapest possible request.
 */

type ProviderHealth = {
  present: boolean;
  ok: boolean;
  status: number | null;
  detail: string;
};

async function withTimeout(fn: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

async function checkBrave(): Promise<ProviderHealth> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { present: false, ok: false, status: null, detail: "BRAVE_SEARCH_API_KEY not set" };
  try {
    const res = await withTimeout((signal) =>
      fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal,
      }),
    );
    if (res.ok) return { present: true, ok: true, status: res.status, detail: "ok" };
    let code = "";
    try { code = (await res.json())?.error?.code ?? ""; } catch {}
    return { present: true, ok: false, status: res.status, detail: code || res.statusText };
  } catch (e) {
    return { present: true, ok: false, status: null, detail: (e as Error).message };
  }
}

async function checkXai(): Promise<ProviderHealth> {
  const key = process.env.XAI_API_KEY;
  if (!key) return { present: false, ok: false, status: null, detail: "XAI_API_KEY not set" };
  try {
    const res = await withTimeout((signal) =>
      fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "grok-3",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal,
      }),
    );
    return { present: true, ok: res.ok, status: res.status, detail: res.ok ? "ok" : res.statusText };
  } catch (e) {
    return { present: true, ok: false, status: null, detail: (e as Error).message };
  }
}

async function checkIsbndb(): Promise<ProviderHealth> {
  const key = process.env.ISBNDB_API_KEY;
  if (!key) return { present: false, ok: false, status: null, detail: "ISBNDB_API_KEY not set" };
  try {
    const res = await withTimeout((signal) =>
      fetch("https://api2.isbndb.com/book/9780743273565", { headers: { Authorization: key }, signal }),
    );
    // 404 = key works, book just not found; treat as healthy. 401/403 = bad key.
    const ok = res.ok || res.status === 404;
    return { present: true, ok, status: res.status, detail: ok ? "ok" : res.statusText };
  } catch (e) {
    return { present: true, ok: false, status: null, detail: (e as Error).message };
  }
}

async function checkGoogleBooks(): Promise<ProviderHealth> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) return { present: false, ok: false, status: null, detail: "GOOGLE_BOOKS_API_KEY not set" };
  try {
    const res = await withTimeout((signal) =>
      fetch(`https://www.googleapis.com/books/v1/volumes?q=test&maxResults=1&key=${key}`, { signal }),
    );
    return { present: true, ok: res.ok, status: res.status, detail: res.ok ? "ok" : res.statusText };
  } catch (e) {
    return { present: true, ok: false, status: null, detail: (e as Error).message };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = request.headers.get("x-enrichment-secret") ?? url.searchParams.get("secret");
  if (!process.env.ENRICHMENT_SECRET || secret !== process.env.ENRICHMENT_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [brave, xai, isbndb, googleBooks] = await Promise.all([
    checkBrave(),
    checkXai(),
    checkIsbndb(),
    checkGoogleBooks(),
  ]);

  // Brave + xAI are the two providers that hard-block enrichment (no web research
  // → no Grok analysis → no summary/ratings). They are CRITICAL. ISBNdb + Google
  // Books degrade quality (covers, metadata) but don't block; report-only.
  const providers = { brave, xai, isbndb, googleBooks };
  const critical = { brave, xai };
  const ok = Object.values(critical).every((p) => p.ok);

  return NextResponse.json({ ok, providers, criticalProviders: ["brave", "xai"] }, { status: ok ? 200 : 503 });
}
