import { NextResponse } from "next/server";
import { createClient } from "@libsql/client";
import { list } from "@vercel/blob";

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

// For SDK-based checks (Turso, Blob) that don't expose an AbortSignal — bound the
// wall-clock so a hung connection can't blow past the 30s function budget.
async function raceTimeout<T>(p: Promise<T>, ms = 10_000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
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

async function checkTurso(): Promise<ProviderHealth> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) return { present: false, ok: false, status: null, detail: "TURSO_DATABASE_URL not set" };
  const client = createClient({ url, authToken });
  try {
    const res = await raceTimeout(client.execute("SELECT 1"));
    const ok = res.rows.length > 0;
    return { present: true, ok, status: ok ? 200 : null, detail: ok ? "ok" : "SELECT 1 returned no rows" };
  } catch (e) {
    // Expired/rotated token surfaces as a LibsqlError (often "401"/"UNAUTHORIZED").
    return { present: true, ok: false, status: null, detail: (e as Error).message };
  } finally {
    client.close();
  }
}

async function checkBlob(): Promise<ProviderHealth> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { present: false, ok: false, status: null, detail: "BLOB_READ_WRITE_TOKEN not set" };
  try {
    // Cheapest authenticated read — validates the token against the Blob API.
    await raceTimeout(list({ token, limit: 1 }));
    return { present: true, ok: true, status: 200, detail: "ok" };
  } catch (e) {
    const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : null;
    return { present: true, ok: false, status, detail: (e as Error).message };
  }
}

async function checkResend(): Promise<ProviderHealth> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { present: false, ok: false, status: null, detail: "RESEND_API_KEY not set" };
  try {
    // Probe auth WITHOUT sending mail: POST /emails with an incomplete body. A
    // valid key authenticates then fails validation (422 "missing `to` field");
    // a bad key fails auth first (401/403). We deliberately don't GET /domains or
    // /api-keys — those require a FULL-access key and 401 for a sending-only key,
    // which is a false negative (the prod key is sending-only). Anything that
    // isn't an auth rejection means the key works.
    const res = await withTimeout((signal) =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: "{}",
        signal,
      }),
    );
    const authFailed = res.status === 401 || res.status === 403;
    return {
      present: true,
      ok: !authFailed,
      status: res.status,
      detail: authFailed ? res.statusText || "auth rejected" : "ok",
    };
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

  const [brave, xai, isbndb, googleBooks, turso, blob, resend] = await Promise.all([
    checkBrave(),
    checkXai(),
    checkIsbndb(),
    checkGoogleBooks(),
    checkTurso(),
    checkBlob(),
    checkResend(),
  ]);

  // CRITICAL = a bad prod value silently breaks a core flow, and the failure mode
  // is exactly the invisible-key-drift class this canary exists for:
  //   • brave + xai — hard-block enrichment (no web research → no Grok → no ratings)
  //   • turso       — the production database; a rotated/expired auth token not
  //                   pushed to Vercel takes the whole app down. Report-only would
  //                   defeat the point.
  // Report-only (degrade a feature, don't block):
  //   • isbndb + googleBooks — metadata/cover quality
  //   • blob                 — cover/avatar uploads
  //   • resend               — verification + notification email
  const providers = { brave, xai, isbndb, googleBooks, turso, blob, resend };
  const criticalNames = ["brave", "xai", "turso"];
  const ok = criticalNames.every((name) => providers[name as keyof typeof providers].ok);

  return NextResponse.json({ ok, providers, criticalProviders: criticalNames }, { status: ok ? 200 : 503 });
}
