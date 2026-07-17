/**
 * Retry enrichment for books stranded by Brave budget exhaustion.
 *
 * When a user adds a book while the shared daily Brave budget is spent, the
 * enrichment fails with `api_exhausted` and the book sits with free-source
 * metadata only (no summary, no content ratings) — the page shows the
 * "queued" banner indefinitely. This lane runs at the START of
 * nightly-discovery (07:21 UTC — fresh UTC budget) and force-enriches the
 * stuck backlog, user-shelved books first, newest first.
 *
 * Mirrors recover-thin-ratings.ts conventions: prod trigger endpoint with
 * {force:true} (server-side writes + budget guard), stops on 503 (cap hit),
 * guarded Turso client for candidate selection.
 *
 * Env: MAX_BOOKS (default 40), TRIGGER_URL, QUERY_TIMEOUT_MS.
 */
import { config } from "dotenv";
config({ path: ".env.local" });        // ENRICHMENT_SECRET
config({ path: ".env.vercel.local" }); // Turso creds
import { createGuardedTurso } from "./lib/turso-guard";

const SECRET = process.env.ENRICHMENT_SECRET!;
const URL = process.env.TRIGGER_URL || "https://thebasedreader.app/api/enrichment/trigger";
const MAX = Number(process.env.MAX_BOOKS) || 40;
const FETCH_TIMEOUT_MS = 120_000;

(async () => {
  const { remote } = await createGuardedTurso({
    name: "retry-stuck-enrichment",
    maxRuntimeMs: 60 * 60 * 1000,
    queryTimeoutMs: Number(process.env.QUERY_TIMEOUT_MS) || 120_000,
    longRunning: false,
  });

  // Stuck = public, zero ratings, no summary, and at least one api_exhausted
  // attempt on record. Shelved-by-users first, then newest additions.
  const rows = (await remote.execute(`
    SELECT b.id, b.slug,
      (SELECT COUNT(*) FROM user_book_state s WHERE s.book_id = b.id) shelved
    FROM books b
    WHERE b.visibility = 'public'
      AND b.summary IS NULL
      AND b.id IN (SELECT DISTINCT book_id FROM enrichment_log WHERE status = 'api_exhausted')
      AND NOT EXISTS (SELECT 1 FROM book_category_ratings r WHERE r.book_id = b.id)
    ORDER BY shelved DESC, b.created_at DESC
    LIMIT ${MAX}`)).rows as unknown as { id: string; slug: string; shelved: number }[];

  console.log(`[retry-stuck] ${rows.length} stuck books queued (cap ${MAX})`);
  let ok = 0, capped = false, failed = 0;

  for (const r of rows) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enrichment-secret": SECRET },
        body: JSON.stringify({ bookId: r.id, force: true }),
        signal: ac.signal,
      });
      if (res.status === 503) { capped = true; console.log(`[retry-stuck] 503 budget cap — stopping`); break; }
      if (res.ok) { ok++; console.log(`[retry-stuck] ok: ${r.slug}${r.shelved ? ` (shelved×${r.shelved})` : ""}`); }
      else { failed++; console.log(`[retry-stuck] HTTP ${res.status}: ${r.slug}`); }
    } catch {
      failed++;
      console.log(`[retry-stuck] fetch failed: ${r.slug}`);
    } finally {
      clearTimeout(t);
    }
  }
  console.log(`[retry-stuck] DONE — enriched ${ok}, failed ${failed}${capped ? ", stopped on budget cap" : ""}`);
  process.exit(0);
})();
