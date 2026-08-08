/**
 * nightly-description-refresh
 *
 * Re-enriches books flagged description_stale=1 so their descriptions get
 * rewritten from the primary sources (OL → ISBNdb → Google Books, filtered
 * through cleanISBNdbSynopsis()).
 *
 * The stale flag is set when a cleanup pass detects junk-like content but
 * can't cleanly clear the description (e.g. legit prose mixed with edition
 * meta). The enrichment pipeline honors the stale flag — see
 * src/lib/enrichment/enrich-book.ts — and clears stale=0 after writing a
 * fresh description.
 *
 * Resilience (added 2026-06-20):
 *  - Watchdog-exempt: full enrichment runs ~15-20s/book, so a 500-book batch
 *    can exceed the 60-min launchd watchdog. We touch /tmp/tbra-longrun-<pid>
 *    so the watchdog skips us, and enforce our OWN graceful wall-clock ceiling
 *    instead (MAX_RUNTIME_MIN). The ceiling exits 0 so the chained
 *    `&& sync-incremental.sh push` still runs and persists whatever completed —
 *    no more orphaned pushes from a mid-run SIGKILL.
 *  - API circuit breaker: enrichBook() re-throws API_EXHAUSTED and silently
 *    skips while a global auto-pause is active. We stop the loop on either
 *    signal rather than spinning through hundreds of no-op books and hammering
 *    an already-overwhelmed API.
 *  - Honest accounting: enrichBook() returns void, so we re-read
 *    description_stale after each call to tell a real enrich (stale cleared)
 *    from a no-op (no clean description found) from a failure.
 *
 * Tunables (env):
 *   BATCH_SIZE       max books to consider this run (default 500)
 *   MAX_RUNTIME_MIN  graceful wall-clock ceiling (default 45 — fits the nightly
 *                    slot before content-ratings at 4:54 AM PT; bump it if the
 *                    chain is re-staggered to give this task a longer window).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import { enrichBook } from "../src/lib/enrichment/enrich-book";
import { startWatchdogExemption } from "./lib/watchdog-exempt";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 500;
const MAX_RUNTIME_MIN = Number(process.env.MAX_RUNTIME_MIN) || 45;
const MAX_RUNTIME_MS = MAX_RUNTIME_MIN * 60 * 1000;
const DELAY_MS = 300;
// After this many consecutive no-op enrichments, confirm whether a global
// auto-pause is the cause (cheap to be wrong; we only stop if truly paused).
const UNCHANGED_BACKOFF_CHECK = 20;

type Row = { id: string; title: string };

// ── Watchdog exemption ────────────────────────────────────────────────────
// The launchd watchdog kills any tbra tsx process older than 60 min UNLESS
// /tmp/tbra-longrun-<pid> exists (see scripts/lib/watchdog.sh). We opt out and
// self-govern via MAX_RUNTIME_MS below. The helper marks the WHOLE npx tsx
// tree, not just our pid — see scripts/lib/watchdog-exempt.ts for why that
// matters (2026-07-26: this script was killed at 64 min because the watchdog
// reaped its unmarked wrapper). Migrated from an inline copy 2026-08-08.
const watchdog = startWatchdogExemption();

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  watchdog.cleanup();
  try {
    db.close();
  } catch {
    /* ignore */
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

// Hard backstop: if a single enrichBook() call hangs on a stuck network
// request (past any per-call timeout), the loop-top ceiling check below would
// never fire. This unref'd timer guarantees we exit. We exit 0 — NOT an error —
// so the chained `&& push` still runs and persists completed work.
const deadline = setTimeout(() => {
  console.error(
    `[description-refresh] HARD CEILING hit (${MAX_RUNTIME_MIN}min) mid-call — exiting 0 so push can run.`,
  );
  cleanup();
  process.exit(0);
}, MAX_RUNTIME_MS);
deadline.unref();

function selectBatch(): Row[] {
  return db
    .prepare(
      `SELECT id, title
       FROM books
       WHERE description_stale = 1
         AND visibility = 'public'
       ORDER BY updated_at ASC
       LIMIT ?`,
    )
    .all(BATCH_SIZE) as Row[];
}

const isStaleStmt = db.prepare(
  `SELECT description_stale AS stale FROM books WHERE id = ?`,
);
function isStillStale(id: string): boolean {
  const row = isStaleStmt.get(id) as { stale: number } | undefined;
  return (row?.stale ?? 0) === 1;
}

// Mirrors the auto-pause check inside enrichBook(): any api_exhausted log in
// the last hour means enrichment is globally paused (a single Brave 422 trips
// it). Reading it here lets us STOP rather than spin through no-op skips.
const autoPauseStmt = db.prepare(
  `SELECT count(*) AS count FROM enrichment_log
   WHERE status = 'api_exhausted'
     AND created_at > datetime('now', '-1 hour')`,
);
function isAutoPaused(): boolean {
  const row = autoPauseStmt.get() as { count: number } | undefined;
  return (row?.count ?? 0) > 0;
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isExhausted(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = e instanceof Error ? e.message : String(e);
  return code === "API_EXHAUSTED" || /exhaust/i.test(msg);
}

async function main() {
  console.log(
    `[description-refresh] Starting — batch ${BATCH_SIZE}, ceiling ${MAX_RUNTIME_MIN}min`,
  );

  // Don't even start if enrichment is globally paused — every call would no-op.
  if (isAutoPaused()) {
    console.log(
      "[description-refresh] Enrichment auto-paused (API exhausted in last hour). Backing off — nothing to do this run.",
    );
    return;
  }

  const rows = selectBatch();
  console.log(`[description-refresh] ${rows.length} books flagged stale`);

  if (rows.length === 0) {
    console.log("[description-refresh] Nothing to do. Exiting.");
    return;
  }

  let enriched = 0; // stale flag cleared — a real refresh
  let unchanged = 0; // ran, but no clean description found (will retry later)
  let failed = 0; // threw a non-exhaustion error
  let processed = 0;
  let consecutiveUnchanged = 0;
  let stopReason: string | null = null;
  const started = Date.now();

  for (let i = 0; i < rows.length; i++) {
    // Graceful wall-clock ceiling: stop cleanly and let the run push what we
    // have. The remainder rolls to the next night (oldest-first ⇒ no rework).
    if (Date.now() - started >= MAX_RUNTIME_MS) {
      stopReason = `time ceiling (${MAX_RUNTIME_MIN}min)`;
      break;
    }

    const r = rows[i];
    if (i % 25 === 0) {
      console.log(
        `  [${i}/${rows.length}] enriched=${enriched} unchanged=${unchanged} failed=${failed}`,
      );
    }

    try {
      await enrichBook(r.id, { skipBrave: true });
      processed++;
      if (isStillStale(r.id)) {
        unchanged++;
        consecutiveUnchanged++;
      } else {
        enriched++;
        consecutiveUnchanged = 0;
      }
    } catch (e: unknown) {
      if (isExhausted(e)) {
        stopReason = "API exhausted (circuit breaker)";
        break;
      }
      console.error(
        `  FAIL ${r.id} "${r.title}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      failed++;
      consecutiveUnchanged = 0;
    }

    // A long no-op streak can mean a global auto-pause crept in mid-run (e.g. a
    // concurrent task tripped it) — enrichBook skips silently in that case, so
    // the stale flag never clears. Confirm before stopping: genuine
    // "no description found" streaks (common) must NOT abort the run.
    if (consecutiveUnchanged >= UNCHANGED_BACKOFF_CHECK) {
      if (isAutoPaused()) {
        stopReason = "API auto-paused mid-run (circuit breaker)";
        break;
      }
      consecutiveUnchanged = 0; // just hard-to-enrich books; keep going
    }

    await delay(DELAY_MS);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const remaining = rows.length - processed - failed;
  console.log(
    `[description-refresh] Done in ${elapsed}s — enriched=${enriched} unchanged=${unchanged} failed=${failed} (processed ${processed}/${rows.length})`,
  );
  if (stopReason) {
    console.log(
      `[description-refresh] Stopped early: ${stopReason}. ~${remaining} stale books remain (will retry next run, oldest-first).`,
    );
  }
  console.log(`[description-refresh] Follow-up: sync-incremental.sh push`);
}

main()
  .then(() => {
    cleanup();
    process.exit(0); // clean exit ⇒ chained `&& push` runs
  })
  .catch((e) => {
    console.error("[description-refresh] FATAL", e);
    cleanup();
    process.exit(1);
  });
