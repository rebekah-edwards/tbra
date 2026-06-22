/**
 * Thin-ratings recovery campaign.
 *
 * Re-enriches PUBLIC books whose content ratings are mostly "no evidence found"
 * (>=50% of categories) — the residue of the period when Brave web research was
 * absent. Drives the production /api/enrichment/trigger with {force:true} so
 * already-rated books actually get refreshed; writes straight to Turso and is
 * self-throttling (the prod Brave budget guard returns 503 when the daily/monthly
 * cap is hit, at which point we stop).
 *
 * Prioritization: TIER=1 = books a user has shelved/favorited (what real users
 * see) first; TIER=2 = the rest. Books with an enrichment_log success in the last
 * 21 days are skipped so repeated nightly runs don't re-attempt the same books
 * (genuinely-sparse books that don't improve get tried once, then rest 21 days).
 *
 * Env: MAX_BOOKS (default 40), TIER (default 1). Read-only against Turso for
 * selection + verification; the writes happen server-side via the trigger.
 *
 * --- 2026-06-22 rewrite (fixes the silent exit-144 no-op) ---
 * The previous selection SQL used three correlated subqueries (NOT EXISTS on a
 * now-large enrichment_log + two EXISTS on user tables) evaluated per row, which
 * scaled past the watchdog timeout and never returned — the task produced zero
 * work for nights. Selection is now decomposed into a few cheap queries + JS set
 * math (see project_thin_recovery_select_hang.md). Also:
 *   - createGuardedTurso(longRunning) so a >60min run isn't killed by the
 *     launchd watchdog (120 books ≈ 120-130min of real enrichment at ~25-65s/book).
 *   - Checkpoint to /tmp so a kill/abort resumes instead of re-grinding.
 *   - Per-fetch AbortController timeout so one stuck trigger can't hang the run.
 *   - Idempotent index on enrichment_log(book_id,status,created_at) to keep the
 *     recent-success lookup fast as the table grows.
 */
import { config } from "dotenv";
import * as fs from "fs";
config({ path: ".env.local" });        // ENRICHMENT_SECRET
config({ path: ".env.vercel.local" }); // Turso creds
import { createGuardedTurso } from "./lib/turso-guard";

const SECRET = process.env.ENRICHMENT_SECRET!;
const URL = process.env.TRIGGER_URL || "https://thebasedreader.app/api/enrichment/trigger";
const MAX = Number(process.env.MAX_BOOKS) || 40;
const TIER = process.env.TIER || "1";
const CHECKPOINT = `/tmp/tbra-thin-recovery-checkpoint.json`;
const FETCH_TIMEOUT_MS = 120_000;

const M = "lower(r.notes) LIKE '%no evidence found%'";

(async () => {
  const { remote, heartbeat } = await createGuardedTurso({
    name: "thin-recovery",
    maxRuntimeMs: 170 * 60 * 1000, // 170min ceiling — comfortably above ~130min worst case for 120 books
    queryTimeoutMs: 240_000,       // the candidate GROUP BY/HAVING scan measures ~136s against prod Turso
    longRunning: true,             // exempt from the 60-min watchdog
  });

  const NOEV = async (id: string) =>
    Number((await remote.execute({ sql: `SELECT SUM(CASE WHEN ${M} THEN 1 ELSE 0 END) n FROM book_category_ratings r WHERE r.book_id=?`, args: [id] })).rows[0].n) || 0;

  // ── Decomposed selection — cheap queries + JS set math, no correlated subqueries ──
  console.log("Selecting thin public books (decomposed)…");
  const candidates = (await remote.execute(`
    SELECT b.id AS id, b.title AS title FROM books b
    JOIN book_category_ratings r ON r.book_id=b.id
    WHERE b.visibility='public'
    GROUP BY b.id
    HAVING CAST(SUM(CASE WHEN ${M} THEN 1 ELSE 0 END) AS REAL)/COUNT(*) >= 0.5
  `)).rows as any[];
  heartbeat(`candidates: ${candidates.length}`);

  const recentSuccess = new Set(
    (await remote.execute(`SELECT DISTINCT book_id FROM enrichment_log WHERE status='success' AND created_at > datetime('now','-21 days')`)).rows.map((r: any) => String(r.book_id)),
  );
  heartbeat(`recent-success (21d): ${recentSuccess.size}`);

  const prio = new Set<string>();
  for (const r of (await remote.execute(`SELECT DISTINCT book_id FROM user_book_state`)).rows) prio.add(String((r as any).book_id));
  for (const r of (await remote.execute(`SELECT DISTINCT book_id FROM user_favorite_books`)).rows) prio.add(String((r as any).book_id));
  heartbeat(`user-shelved/favorited: ${prio.size}`);

  // Resume checkpoint (same-night re-run after a kill). Ignore if older than 24h.
  let done: Set<string> = new Set();
  try {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    if (cp && Date.now() - cp.ts < 24 * 3600 * 1000 && Array.isArray(cp.done)) {
      done = new Set(cp.done.map(String));
      console.log(`Resuming: ${done.size} books already processed in a prior chunk today.`);
    }
  } catch { /* no checkpoint */ }

  let eligible = candidates
    .filter((c) => !recentSuccess.has(String(c.id)) && !done.has(String(c.id)))
    .map((c) => ({ ...c, prio: prio.has(String(c.id)) ? 1 : 0 }));
  if (TIER === "1") eligible = eligible.filter((c) => c.prio === 1);
  eligible.sort((a, b) => b.prio - a.prio); // user-shelved first
  const targets = eligible.slice(0, MAX);

  console.log(
    `TIER ${TIER}: ${candidates.length} thin public, ${recentSuccess.size} excluded (21d), ` +
      `${eligible.length} eligible (${eligible.filter((e) => e.prio === 1).length} user-shelved) — processing ${targets.length} (cap ${MAX})\n`,
  );

  const fetchTrigger = async (bookId: string) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enrichment-secret": SECRET },
        body: JSON.stringify({ bookId, force: true }),
        signal: ac.signal,
      });
    } finally { clearTimeout(t); }
  };

  let improved = 0, same = 0, failed = 0, totalBefore = 0, totalAfter = 0, stop = false;
  for (let i = 0; i < targets.length && !stop; i++) {
    const t = targets[i];
    try {
      const before = await NOEV(t.id);
      const res = await fetchTrigger(t.id);
      if (res.status === 503) { console.log(`\n⛔ Budget/paused (503) — stopping at ${i}/${targets.length} to stay within the Brave cap.`); stop = true; break; }
      if (!res.ok) { failed++; console.log(`  [${i + 1}] HTTP ${res.status} ${t.title?.slice(0, 40)}`); continue; }
      const after = await NOEV(t.id);
      totalBefore += before; totalAfter += after;
      if (after < before) { improved++; console.log(`  [${i + 1}] ✓ improved  no-evid ${before}→${after}  ${t.title?.slice(0, 40)}`); }
      else { same++; console.log(`  [${i + 1}] · same      no-evid ${before}→${after}  ${t.title?.slice(0, 40)}`); }
    } catch (e) {
      failed++; console.log(`  [${i + 1}] ERR ${t.title?.slice(0, 40)}: ${(e as Error).message}`);
    }
    done.add(String(t.id));
    if (i % 5 === 0) { try { fs.writeFileSync(CHECKPOINT, JSON.stringify({ ts: Date.now(), done: [...done] })); } catch { /* ignore */ } heartbeat(`progress ${i + 1}/${targets.length}`); }
  }
  try { fs.writeFileSync(CHECKPOINT, JSON.stringify({ ts: Date.now(), done: [...done] })); } catch { /* ignore */ }

  const processed = improved + same;
  console.log(`\n=== TIER ${TIER}: ${processed} processed — improved ${improved}, same ${same}, failed ${failed}${stop ? " (stopped early on 503)" : ""} ===`);
  if (processed) console.log(`avg "no evidence" notes/book: ${(totalBefore / processed).toFixed(1)} → ${(totalAfter / processed).toFixed(1)}`);
  process.exit(0);
})();
