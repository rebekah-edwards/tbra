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
// How long a checkpoint stays valid. Its ONLY job is to let a killed run resume
// within the same night without redoing books, so this must be comfortably
// longer than one run (~1h) and comfortably SHORTER than the gap between
// nightly runs (24h) — otherwise the checkpoint survives into the next night
// and permanently excludes books. See the window-start note below.
const CHECKPOINT_WINDOW_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 120_000;

const M = "lower(r.notes) LIKE '%no evidence found%'";

(async () => {
  // Whole-process-tree watchdog exemption comes from { longRunning: true }
  // below — turso-guard delegates to startWatchdogExemption() and tears it
  // down in its own cleanup.
  const { remote, heartbeat } = await createGuardedTurso({
    name: "thin-recovery",
    maxRuntimeMs: 170 * 60 * 1000, // 170min ceiling — comfortably above ~130min worst case for 120 books
    // The candidate scan drifts up as book_category_ratings grows (38s → 136s → >240s by 2026-07-03).
    // Generous default + env override; longRunning ceiling (170min) leaves plenty of room.
    queryTimeoutMs: Number(process.env.QUERY_TIMEOUT_MS) || 480_000,
    longRunning: true,             // exempt from the 60-min watchdog
  });

  const NOEV = async (id: string) =>
    Number((await remote.execute({ sql: `SELECT SUM(CASE WHEN ${M} THEN 1 ELSE 0 END) n FROM book_category_ratings r WHERE r.book_id=?`, args: [id] })).rows[0].n) || 0;

  // ── Decomposed selection — cheap queries + JS set math, no correlated subqueries ──
  // The aggregate is computed over book_category_ratings ALONE (no per-row join to the
  // full books table for the visibility check — that join is what made the scan drift
  // past the timeout as the ratings table grew). Public-visibility is filtered in JS
  // against a cheap id set, and titles are fetched only for the ≤MAX final targets.
  console.log("Selecting thin books by ratings (decomposed, no books-join)…");
  const M2 = "lower(notes) LIKE '%no evidence found%'";
  const thinByRatings = (await remote.execute(`
    SELECT book_id AS id FROM book_category_ratings
    GROUP BY book_id
    HAVING CAST(SUM(CASE WHEN ${M2} THEN 1 ELSE 0 END) AS REAL)/COUNT(*) >= 0.5
  `)).rows.map((r: any) => String(r.id));
  heartbeat(`thin-by-ratings: ${thinByRatings.length}`);

  const publicIds = new Set(
    (await remote.execute(`SELECT id FROM books WHERE visibility='public'`)).rows.map((r: any) => String(r.id)),
  );
  heartbeat(`public books: ${publicIds.size}`);

  const candidates = thinByRatings
    .filter((id) => publicIds.has(id))
    .map((id) => ({ id, title: "" as string }));
  heartbeat(`candidates (thin+public): ${candidates.length}`);

  const recentSuccess = new Set(
    (await remote.execute(`SELECT DISTINCT book_id FROM enrichment_log WHERE status='success' AND created_at > datetime('now','-21 days')`)).rows.map((r: any) => String(r.book_id)),
  );
  heartbeat(`recent-success (21d): ${recentSuccess.size}`);

  const prio = new Set<string>();
  for (const r of (await remote.execute(`SELECT DISTINCT book_id FROM user_book_state`)).rows) prio.add(String((r as any).book_id));
  for (const r of (await remote.execute(`SELECT DISTINCT book_id FROM user_favorite_books`)).rows) prio.add(String((r as any).book_id));
  heartbeat(`user-shelved/favorited: ${prio.size}`);

  // Resume checkpoint (same-night re-run after a kill).
  //
  // `ts` is the START of the resume window and must be carried forward
  // unchanged on every rewrite. Stamping it with Date.now() on each save (as
  // this did until 2026-08-08) made the expiry unreachable: every nightly run
  // refreshed the timestamp, so the file never aged out and `done` accumulated
  // across nights — 540 ids from 9 consecutive runs by the time it was caught,
  // permanently excluding books from the candidate pool.
  let done: Set<string> = new Set();
  let windowStart = Date.now();
  try {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    if (cp && Date.now() - cp.ts < CHECKPOINT_WINDOW_MS && Array.isArray(cp.done)) {
      done = new Set(cp.done.map(String));
      windowStart = cp.ts;
      const ageMin = Math.round((Date.now() - cp.ts) / 60_000);
      console.log(`Resuming: ${done.size} books already processed in a prior chunk (window opened ${ageMin}min ago).`);
    }
  } catch { /* no checkpoint */ }
  const saveCheckpoint = () => {
    try { fs.writeFileSync(CHECKPOINT, JSON.stringify({ ts: windowStart, done: [...done] })); } catch { /* ignore */ }
  };

  let eligible = candidates
    .filter((c) => !recentSuccess.has(String(c.id)) && !done.has(String(c.id)))
    .map((c) => ({ ...c, prio: prio.has(String(c.id)) ? 1 : 0 }));
  if (TIER === "1") eligible = eligible.filter((c) => c.prio === 1);
  eligible.sort((a, b) => b.prio - a.prio); // user-shelved first
  const targets = eligible.slice(0, MAX);

  // Backfill titles for just the final targets (only used in log lines).
  if (targets.length) {
    const placeholders = targets.map(() => "?").join(",");
    const titleRows = (await remote.execute({
      sql: `SELECT id, title FROM books WHERE id IN (${placeholders})`,
      args: targets.map((t) => t.id),
    })).rows as any[];
    const titleMap = new Map(titleRows.map((r) => [String(r.id), r.title]));
    for (const t of targets) t.title = titleMap.get(String(t.id)) ?? "";
  }

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
    if (i % 5 === 0) { saveCheckpoint(); heartbeat(`progress ${i + 1}/${targets.length}`); }
  }
  saveCheckpoint();

  const processed = improved + same;
  console.log(`\n=== TIER ${TIER}: ${processed} processed — improved ${improved}, same ${same}, failed ${failed}${stop ? " (stopped early on 503)" : ""} ===`);
  if (processed) console.log(`avg "no evidence" notes/book: ${(totalBefore / processed).toFixed(1)} → ${(totalAfter / processed).toFixed(1)}`);
  // Explicit exit: after the last fetch(), undici's pooled sockets keep the
  // process alive long past the loop (observed >12min elsewhere).

  process.exit(0);
})();
