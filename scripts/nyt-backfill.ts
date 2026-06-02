/**
 * Retroactive NYT bestseller backfill.
 *
 * Walks BACKWARD through historical NYT lists (the dated-list endpoint), one week
 * at a time, caching every entry into nyt_bestsellers. Resumable via a cursor file
 * so each nightly run continues where the last left off. Writes LOCAL only — the
 * nightly sync-push propagates the rows to Turso.
 *
 * Budget: NYT free tier is 500 req/day & 5/min. The current-list capture in
 * nightly-discovery uses ~10/day, so this backfill defaults to ~120 calls/run
 * (env NYT_BACKFILL_CALLS) spaced 12.5s apart (~25 min — safely under the 60-min
 * watchdog and the daily quota with headroom for user-facing usage).
 *
 * Env knobs:
 *   NYT_BACKFILL_CALLS   max API calls this run (default 120)
 *   NYT_BACKFILL_LISTS   comma-separated list slugs (default: the 3 high-value)
 *   NYT_BACKFILL_MIN     oldest date to walk back to (default 2011-02-13)
 */
require("dotenv").config({ path: ".env.local" });

import { fetchNytList, upsertNytEntries, NYT_DELAY_MS } from "../src/lib/enrichment/nyt";
import fs from "fs";
import path from "path";

const CURSOR_FILE = path.join(process.cwd(), "data", "nyt-backfill-cursor.json");
const MAX_RUNTIME_MS = 50 * 60 * 1000; // self-stop before the 60-min watchdog

// Default to the two WEEKLY combined lists — they have the broadest coverage and
// (unlike the monthly religion list) return data for every weekly cursor date, so
// no backfill calls are wasted on 404s. Override via NYT_BACKFILL_LISTS.
const BACKFILL_LISTS = (process.env.NYT_BACKFILL_LISTS ??
  "combined-print-and-e-book-fiction,combined-print-and-e-book-nonfiction")
  .split(",").map((s) => s.trim()).filter(Boolean);
const CALL_BUDGET = Number(process.env.NYT_BACKFILL_CALLS) || 120;
const MIN_DATE = process.env.NYT_BACKFILL_MIN || "2011-02-13";

function toISO(d: Date): string { return d.toISOString().slice(0, 10); }
function minusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return toISO(d);
}
function lastSunday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return toISO(d);
}
function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function readCursor(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8"));
    if (raw?.cursorDate) return raw.cursorDate as string;
  } catch { /* no cursor yet */ }
  return lastSunday();
}
function writeCursor(cursorDate: string) {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursorDate, updatedAt: new Date().toISOString() }, null, 2));
}

(async () => {
  const apiKey = process.env.NYT_API_KEY;
  if (!apiKey) {
    console.log("[nyt-backfill] NYT_API_KEY not set — nothing to do.");
    process.exit(0);
  }

  const start = Date.now();
  let cursor = readCursor();
  let calls = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let weeks = 0;

  console.log(`[nyt-backfill] lists=[${BACKFILL_LISTS.join(", ")}] budget=${CALL_BUDGET} calls, from ${cursor} back to ${MIN_DATE}`);

  while (calls < CALL_BUDGET && cursor >= MIN_DATE) {
    if (Date.now() - start > MAX_RUNTIME_MS) {
      console.log("[nyt-backfill] hit runtime cap, stopping");
      break;
    }
    for (const list of BACKFILL_LISTS) {
      if (calls >= CALL_BUDGET) break;
      const { ok, status, entries, listDate } = await fetchNytList(list, apiKey, cursor);
      calls++;
      if (!ok) {
        console.warn(`  [${cursor} ${list}] HTTP ${status} — skipped`);
      } else {
        const s = await upsertNytEntries(entries, list, listDate ?? cursor);
        totalInserted += s.inserted;
        totalUpdated += s.updated;
        console.log(`  [${cursor} ${list}] ${entries.length} entries (+${s.inserted} new, ${s.updated} upd)`);
      }
      await delay(NYT_DELAY_MS);
    }
    weeks++;
    cursor = minusDays(cursor, 7);
    writeCursor(cursor); // persist after each fully-processed week
  }

  const done = cursor < MIN_DATE;
  console.log(`[nyt-backfill] done this run: ${weeks} weeks, ${calls} calls, +${totalInserted} new / ${totalUpdated} updated. Next cursor: ${cursor}${done ? " (BACKFILL COMPLETE — reached MIN_DATE)" : ""}`);
  process.exit(0);
})().catch((err) => {
  console.error("[nyt-backfill] failed:", err);
  process.exit(1);
});
