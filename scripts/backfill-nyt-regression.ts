/**
 * Backfill re-enrichment for the NYT content-details regression (2026-06-08).
 *
 * Re-runs enrichBook() on user-added books created since the NYT cache change
 * (2026-06-02) so their content ratings get a fresh, complete Grok pass under the
 * fixed description pipeline. Safe to re-run: enrichBook only overwrites
 * `ai_inferred` ratings (human-verified edits are preserved), and we resume from a
 * cursor so already-processed books are skipped.
 *
 * For books whose stored description is exactly the short NYT blurb (i.e. Phase 0.2
 * pre-empted the fuller cascade), we flip description_stale=true first so the now-
 * fixed OL/ISBNdb/Brave cascade can replace it with fuller publisher text.
 *
 * Stops gracefully if the Brave/Grok APIs report exhaustion so we never burn past
 * the daily/credit budget. Re-run later to continue.
 *
 * LOCAL ONLY. Push to Turso afterwards with push-content-ratings-to-turso.ts.
 */
import * as fs from "fs";
import * as path from "path";

// ── Load .env.local ──
const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  let val = trimmed.slice(eqIdx + 1);
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  process.env[key] = val;
}
process.env.ENRICHMENT_PAUSED = "false";

import { db } from "../src/db";
import { books, userBookState, bookCategoryRatings } from "../src/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { enrichBook } from "../src/lib/enrichment/enrich-book";
import { findNytMatch } from "../src/lib/enrichment/nyt";
import { braveSearch } from "../src/lib/enrichment/search";

const SINCE = "2026-06-02";
const CURSOR = path.join(process.cwd(), "reports", "nyt-backfill-cursor.json");
const DELAY_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadDone(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(CURSOR, "utf8")).done as string[]);
  } catch {
    return new Set();
  }
}
function saveDone(done: Set<string>) {
  fs.mkdirSync(path.dirname(CURSOR), { recursive: true });
  fs.writeFileSync(CURSOR, JSON.stringify({ done: [...done] }, null, 2));
}

function nonzeroCount(rows: { intensity: number }[]) {
  return rows.filter((r) => r.intensity > 0).length;
}

(async () => {
  // PREFLIGHT: never re-enrich existing books without live web research — that
  // strips Grok's content evidence and bakes thinner ratings over good ones. A
  // dead/invalid Brave key surfaces as a throw here; abort before touching anything.
  try {
    const test = await braveSearch("the hobbit book review", 3);
    if (test.length === 0) {
      console.error("[backfill] ABORT: Brave returned 0 results for a known query. Web research is unavailable — re-enriching now would degrade content ratings. Fix BRAVE_SEARCH_API_KEY first.");
      process.exit(1);
    }
    console.log(`[backfill] Brave preflight OK (${test.length} results).`);
  } catch (e) {
    console.error(`[backfill] ABORT: Brave preflight failed — ${e instanceof Error ? e.message : String(e)}. Fix BRAVE_SEARCH_API_KEY and re-run.`);
    process.exit(1);
  }

  // Distinct user-added books created since the regression, oldest first.
  const targets = (await db.all(sql`
    SELECT DISTINCT b.id AS id, b.title AS title, b.isbn_13 AS isbn13,
           b.description AS description, b.description_stale AS stale
    FROM books b
    JOIN user_book_state ubs ON ubs.book_id = b.id
    WHERE b.created_at >= ${SINCE}
    ORDER BY b.created_at ASC
  `)) as { id: string; title: string; isbn13: string | null; description: string | null; stale: number }[];

  const done = loadDone();
  const pending = targets.filter((t) => !done.has(t.id));
  console.log(`[backfill] ${targets.length} user-added books since ${SINCE}; ${done.size} already done; ${pending.length} pending.`);

  let ok = 0, failed = 0, unstaled = 0, before = 0, after = 0, measured = 0;

  for (const [i, b] of pending.entries()) {
    // Author for NYT match.
    const authorRow = (await db.all(sql`
      SELECT a.name AS name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
      WHERE ba.book_id = ${b.id} LIMIT 1
    `)) as { name: string }[];
    const author = authorRow[0]?.name ?? null;

    // Un-stale the NYT-pre-empted descriptions so the fixed cascade can improve them.
    try {
      const nyt = await findNytMatch({ isbn13: b.isbn13, title: b.title, author });
      if (nyt?.description && b.description && nyt.description.trim() === b.description.trim()) {
        await db.update(books).set({ descriptionStale: true }).where(eq(books.id, b.id));
        unstaled++;
      }
    } catch { /* non-fatal */ }

    // Measure nonzero ratings before.
    const pre = (await db.select({ intensity: bookCategoryRatings.intensity })
      .from(bookCategoryRatings).where(eq(bookCategoryRatings.bookId, b.id))).map((r) => ({ intensity: r.intensity }));
    const preNonzero = nonzeroCount(pre);

    try {
      await enrichBook(b.id, { skipBrave: true });
      ok++;
      const post = (await db.select({ intensity: bookCategoryRatings.intensity })
        .from(bookCategoryRatings).where(eq(bookCategoryRatings.bookId, b.id))).map((r) => ({ intensity: r.intensity }));
      before += preNonzero; after += nonzeroCount(post); measured++;
      console.log(`[backfill] ${i + 1}/${pending.length} OK  "${b.title}"  nonzero ${preNonzero}→${nonzeroCount(post)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string }).code;
      if (code === "API_EXHAUSTED" || /exhausted/i.test(msg)) {
        console.error(`[backfill] API exhausted at "${b.title}" — stopping gracefully. Re-run later to continue.`);
        break;
      }
      failed++;
      console.warn(`[backfill] ${i + 1}/${pending.length} FAIL "${b.title}": ${msg}`);
    }

    done.add(b.id);
    if ((i + 1) % 5 === 0) saveDone(done);
    await sleep(DELAY_MS);
  }

  saveDone(done);
  console.log(`\n[backfill] Summary: ${ok} re-enriched, ${failed} failed, ${unstaled} NYT descriptions un-staled.`);
  if (measured > 0) {
    console.log(`[backfill] Avg nonzero content categories: ${(before / measured).toFixed(2)} → ${(after / measured).toFixed(2)} across ${measured} books.`);
  }
  console.log(`[backfill] Cursor: ${CURSOR} (${done.size}/${targets.length} done).`);
  process.exit(0);
})();
