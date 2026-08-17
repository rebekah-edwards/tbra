import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import { startWatchdogExemption } from "./lib/watchdog-exempt";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

// Nightly batch size. Dropped 700 → 500 (2026-06-17) to fit the Brave budget:
// $505/mo ÷ $5 per 1,000 calls = 101,000 calls/mo; at ~5 Brave calls/book a
// 500-book night = 2,500 calls, leaving daily headroom for user search-adds
// under the ~3,300/day cap. Override via env BACKFILL_LIMIT.
const BACKFILL_LIMIT = Number(process.env.BACKFILL_LIMIT) || 500;

// Graceful wall-clock ceiling. Full content enrichment runs ~15-50s/book, so a
// 450-book night takes multiple hours — far past the 60-min launchd watchdog.
// Default 150min from a 4:54 AM start lands us at ~7:25 AM, before the daytime
// window where we'd compete with live user adds for the shared Brave budget.
const MAX_RUNTIME_MIN = Number(process.env.MAX_RUNTIME_MIN) || 150;
const MAX_RUNTIME_MS = MAX_RUNTIME_MIN * 60 * 1000;

// Books enriched in parallel. The work is ~99% IO wait (OL/ISBNdb/LoC/Brave/Grok),
// so the old serial loop burned ~60s of wall clock per book and the 150min ceiling
// cut every 450-book night down to ~150 (observed 2026-08-08). 4 in flight fits the
// batch inside the window with room to spare. Kept modest on purpose: the local dev
// server serves these, SQLite is single-writer, and ISBNdb allows 3/sec (its limiter
// in src/lib/enrichment/isbndb.ts was made concurrency-safe for this).
const CONCURRENCY = Number(process.env.CONCURRENCY) || 4;

// Per-book request timeout. The trigger route's maxDuration is 120s.
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 180_000;

// ── Watchdog exemption ────────────────────────────────────────────────────
// The launchd watchdog kills any tbra tsx process older than 60 min UNLESS
// /tmp/tbra-longrun-<pid> exists. 2026-07-29: this script was SIGKILLed at
// 63 min with only ~81 of 450 books done. The marker is PER-PID and `npx tsx`
// runs us under a wrapper chain plus esbuild service children, all of which
// match the watchdog filter — so we exempt the whole process tree (ancestors
// and descendants) and refresh it, since esbuild children can be respawned.
// Shared helper (scripts/lib/watchdog-exempt.ts) — migrated from an inline
// copy 2026-08-08. Same pattern as scripts/description-refresh.ts.
const watchdog = startWatchdogExemption();

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  watchdog.cleanup();
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

// Hard backstop in case a single /api/enrichment/trigger call hangs past any
// per-call timeout — the loop-top check below would never fire. Exit 0, NOT an
// error, so the wrapper's chained push still persists whatever completed.
const started = Date.now();
const deadline = setTimeout(() => {
  console.error(
    `[enrich-content-700] HARD CEILING hit (${MAX_RUNTIME_MIN}min) mid-call — exiting 0 so push can run.`,
  );
  cleanup();
  process.exit(0);
}, MAX_RUNTIME_MS);
deadline.unref();

// ── Candidate selection ───────────────────────────────────────────────────
// Two pools, both filtered to visibility='public' (import_only search-added
// books are handled by scripts/fix-shelf-enrichment.ts, not here):
//
//   UNRATED — no book_category_ratings rows at all. The book page shows no
//             ratings whatsoever. Enriched without force.
//   THIN    — has ratings, but >=50% of categories are "no evidence found"
//             (the residue of the Brave-less window). Invisible to the old
//             NOT IN query, which is why ~23k of them sat untouched while this
//             lane ground through a 6k unrated pile. Needs force:true or the
//             trigger's idempotency check skips them as "Already enriched".
//
// Thin books carry the same 21-day enrichment_log success cooldown that
// recover-thin-ratings.ts uses, so genuinely-sparse books that never improve
// get one attempt and then rest — and so the two lanes don't re-grind the same
// books on the same night.
type Candidate = {
  id: string;
  title: string;
  thin: 0 | 1;
  tier: 1 | 2 | 3;
  rank: number;   // NYT best_rank (tier 2 only); lower is better
  weeks: number;  // NYT weeks_on_list (tier 2 only); higher is better
  createdAt: string;
};

const THIN_PREDICATE = `
  CAST(SUM(CASE WHEN lower(notes) LIKE '%no evidence found%' THEN 1 ELSE 0 END) AS REAL)
    / COUNT(*) >= 0.5`;

// The trigger route applies a 3-day attempt-recency cooldown to non-force books
// (any enrichment_log row, whatever wrote it). The Brave-free ingestion lanes
// stamp `success` on the very books they deliberately leave unrated, so without
// this filter the selector kept picking books the route was guaranteed to skip:
// on 2026-08-17 all 450 came back "skipped" in under 10s and the night was a
// no-op (701 of 732 user-shelved unrated books were inside the cooldown).
// Mirrors the enrichment_log exclusion the thin pool already carries.
const unrated = db.prepare(`
  SELECT b.id, b.title, b.created_at AS createdAt
  FROM books b
  WHERE b.visibility = 'public'
    AND b.id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)
    AND b.id NOT IN (
      SELECT DISTINCT book_id FROM enrichment_log
      WHERE created_at > datetime('now', '-3 days')
    )
`).all() as { id: string; title: string; createdAt: string }[];

const thin = db.prepare(`
  SELECT b.id, b.title, b.created_at AS createdAt
  FROM books b
  JOIN (
    SELECT book_id FROM book_category_ratings
    GROUP BY book_id HAVING ${THIN_PREDICATE}
  ) t ON t.book_id = b.id
  WHERE b.visibility = 'public'
    AND b.id NOT IN (
      SELECT DISTINCT book_id FROM enrichment_log
      WHERE status = 'success' AND created_at > datetime('now', '-21 days')
    )
`).all() as { id: string; title: string; createdAt: string }[];

// ── Priority signals ──────────────────────────────────────────────────────
// Tier 1: a real user has this on a shelf or in favorites — what people see.
// Tier 2: NYT bestseller provenance (ISBN-13 match, titleKey fallback), the
//         strongest "this is a book people search for" signal we store.
// Tier 3: everything else, newest first. There is NO import-provenance column
//         on books, so recency is the proxy for discovery/breadth/upcoming
//         imports — it also front-loads new releases, which is what the
//         ingestion lanes are adding. This replaces ORDER BY b.title, which
//         made ~96% of each night's batch alphabetical.
const userBooks = new Set<string>();
for (const r of db.prepare(`SELECT DISTINCT book_id FROM user_book_state`).all() as { book_id: string }[]) userBooks.add(r.book_id);
for (const r of db.prepare(`SELECT DISTINCT book_id FROM user_favorite_books`).all() as { book_id: string }[]) userBooks.add(r.book_id);

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type NytHit = { rank: number; weeks: number };
const nytByIsbn = new Map<string, NytHit>();
const nytByTitleKey = new Map<string, NytHit>();
for (const r of db.prepare(
  `SELECT isbn_13, title_key, best_rank, weeks_on_list FROM nyt_bestsellers`,
).all() as { isbn_13: string | null; title_key: string | null; best_rank: number | null; weeks_on_list: number | null }[]) {
  const hit: NytHit = { rank: r.best_rank ?? 999, weeks: r.weeks_on_list ?? 0 };
  if (r.isbn_13) nytByIsbn.set(r.isbn_13, hit);
  if (r.title_key) nytByTitleKey.set(r.title_key, hit);
}

// title|author key per book, for the NYT titleKey fallback (many catalog books
// have no ISBN-13, so ISBN matching alone finds almost nothing).
const bookIsbn = new Map<string, string>();
for (const r of db.prepare(
  `SELECT id, isbn_13 FROM books WHERE visibility='public' AND isbn_13 IS NOT NULL`,
).all() as { id: string; isbn_13: string }[]) bookIsbn.set(r.id, r.isbn_13);

const bookAuthor = new Map<string, string>();
for (const r of db.prepare(`
  SELECT ba.book_id, MIN(a.name) AS name
  FROM book_authors ba JOIN authors a ON a.id = ba.author_id
  WHERE ba.role = 'author'
  GROUP BY ba.book_id
`).all() as { book_id: string; name: string }[]) bookAuthor.set(r.book_id, r.name);

db.close();

function classify(b: { id: string; title: string; createdAt: string }, isThin: 0 | 1): Candidate {
  const base = { id: b.id, title: b.title, thin: isThin, createdAt: b.createdAt };
  if (userBooks.has(b.id)) return { ...base, tier: 1, rank: 999, weeks: 0 };

  const isbn = bookIsbn.get(b.id);
  const nyt =
    (isbn ? nytByIsbn.get(isbn) : undefined) ??
    nytByTitleKey.get(`${norm(b.title)}|${norm(bookAuthor.get(b.id))}`);
  if (nyt) return { ...base, tier: 2, rank: nyt.rank, weeks: nyt.weeks };

  return { ...base, tier: 3, rank: 999, weeks: 0 };
}

const candidates: Candidate[] = [
  ...unrated.map((b) => classify(b, 0)),
  ...thin.map((b) => classify(b, 1)),
].sort((a, b) =>
  // tier → unrated before thin (a book with nothing is worse than a book with
  // something poor) → NYT rank/weeks → newest first
  a.tier - b.tier ||
  a.thin - b.thin ||
  a.rank - b.rank ||
  b.weeks - a.weeks ||
  (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0),
);

const books = candidates.slice(0, BACKFILL_LIMIT);

const tally = (t: number) => books.filter((b) => b.tier === t).length;
console.log(
  `Candidate pool: ${candidates.length} (${unrated.length} unrated, ${thin.length} thin)`,
);
console.log("Found " + books.length + " books to enrich for content details");
console.log(
  `  tiers: ${tally(1)} user-shelved, ${tally(2)} NYT, ${tally(3)} other (newest first)`,
);
console.log(
  `  ${books.filter((b) => b.thin === 0).length} unrated, ${books.filter((b) => b.thin === 1).length} thin (force re-enrich)`,
);
console.log("Estimated Brave calls: ~" + (books.length * 6));

// DRY_RUN=1 prints the plan (selection + ordering) and exits without spending
// any budget — use it to sanity-check prioritization changes before a night.
if (process.env.DRY_RUN === "1") {
  console.log("\nDRY_RUN — first 15 in order:");
  for (const b of books.slice(0, 15)) {
    console.log(
      `  t${b.tier} ${b.thin ? "thin " : "unrated"} rank=${b.rank === 999 ? "-" : b.rank} ${b.createdAt.slice(0, 10)}  ${b.title.slice(0, 60)}`,
    );
  }
  cleanup();
  process.exit(0);
}

async function run() {
  let success = 0, fail = 0, skip = 0, done = 0;
  let stopReason = "batch complete";
  let stopped = false;
  let next = 0;

  const stop = (reason: string) => {
    if (stopped) return;
    stopped = true;
    stopReason = reason;
  };

  async function enrichOne(book: Candidate) {
    // Per-request timeout: with workers running concurrently, one hung trigger
    // would otherwise idle a whole lane until the process-wide hard ceiling.
    // The route's maxDuration is 120s, so 180s only fires on a genuine hang.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch("http://localhost:3000/api/enrichment/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id, force: book.thin === 1 }),
        signal: ac.signal,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.skipped) skip++;
        else success++;
        return;
      }

      // 503 = budget exhausted or global auto-pause. Every remaining book would
      // fail the same way, so stop the run instead of burning through the batch
      // (matches recover-thin-ratings.ts). The push step still runs.
      if (res.status === 503) {
        stop(`budget/paused (503) at ${done + 1}/${books.length}`);
        console.log("  ⛔ Budget exhausted or enrichment paused (503) — stopping.");
        return;
      }

      fail++;
      if (fail <= 5) {
        const text = await res.text();
        console.log("  FAIL " + book.title + ": " + text.slice(0, 80));
      }
    } catch (err: any) {
      fail++;
      if (fail <= 5) {
        const why = err?.name === "AbortError" ? `timeout after ${FETCH_TIMEOUT_MS / 1000}s` : err.message;
        console.log("  ERR " + book.title + ": " + why);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Worker pool: CONCURRENCY books in flight, each worker pulling the next index.
  // Enrichment is almost entirely IO wait (OL/ISBNdb/LoC/Brave/Grok), so the
  // serial loop left the wall clock idle — 450 books at ~60s each needed 7.5h
  // against a 150min ceiling and only ever finished a third of the batch.
  async function worker(slot: number) {
    // Stagger starts so N workers don't hit the dev server in one burst.
    await new Promise((r) => setTimeout(r, slot * 250));
    while (!stopped) {
      if (Date.now() - started >= MAX_RUNTIME_MS) {
        stop("time ceiling (" + MAX_RUNTIME_MIN + "min) at book " + done + "/" + books.length);
        return;
      }
      const i = next++;
      if (i >= books.length) return;

      await enrichOne(books[i]);

      done++;
      if (done % 25 === 0) {
        const mins = Math.round((Date.now() - started) / 60000);
        console.log(
          `Progress: ${done}/${books.length} (${success} ok, ${fail} fail, ${skip} skip) — ${mins}min`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, books.length) }, (_, i) => worker(i)),
  );

  console.log("");
  console.log("Done: " + success + " enriched, " + fail + " failed, " + skip + " skipped");
  console.log("Stopped: " + stopReason + " after " + Math.round((Date.now() - started) / 60000) + "min");
  // Explicit exit: undici keeps pooled sockets open after the last fetch, so
  // the process can linger long after the loop finishes and stall the wrapper
  // before its push step (observed 2026-07-29). Exit 0 so `&& push` runs.
  cleanup();
  process.exit(0);
}

run();
