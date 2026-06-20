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
 */
import { config } from "dotenv";
config({ path: ".env.local" });        // ENRICHMENT_SECRET
config({ path: ".env.vercel.local" }); // Turso creds
import { createClient } from "@libsql/client";

const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const SECRET = process.env.ENRICHMENT_SECRET!;
const URL = process.env.TRIGGER_URL || "https://thebasedreader.app/api/enrichment/trigger";
const MAX = Number(process.env.MAX_BOOKS) || 40;
const TIER = process.env.TIER || "1";

const M = "lower(r.notes) LIKE '%no evidence found%'";
const NOEV = async (id: string) =>
  Number((await db.execute({ sql: `SELECT SUM(CASE WHEN ${M} THEN 1 ELSE 0 END) n FROM book_category_ratings r WHERE r.book_id=?`, args: [id] })).rows[0].n) || 0;

(async () => {
  const tierFilter =
    TIER === "1"
      ? `AND (EXISTS(SELECT 1 FROM user_book_state s WHERE s.book_id=b.id) OR EXISTS(SELECT 1 FROM user_favorite_books f WHERE f.book_id=b.id))`
      : "";
  const sql = `
    SELECT b.id, b.title FROM books b
    JOIN book_category_ratings r ON r.book_id=b.id
    WHERE b.visibility='public'
      ${tierFilter}
      AND NOT EXISTS (SELECT 1 FROM enrichment_log el WHERE el.book_id=b.id AND el.status='success' AND el.created_at > datetime('now','-21 days'))
    GROUP BY b.id
    HAVING CAST(SUM(CASE WHEN ${M} THEN 1 ELSE 0 END) AS REAL)/COUNT(*) >= 0.5
    LIMIT ${MAX}`;
  const targets = (await db.execute(sql)).rows as any[];
  console.log(`TIER ${TIER}: ${targets.length} thin books to re-enrich (cap ${MAX})\n`);

  let improved = 0, same = 0, failed = 0, totalBefore = 0, totalAfter = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const before = await NOEV(t.id);
    let res;
    try {
      res = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", "x-enrichment-secret": SECRET }, body: JSON.stringify({ bookId: t.id, force: true }) });
    } catch (e) { failed++; console.log(`  [${i + 1}] ERR ${t.title?.slice(0, 40)}: ${(e as Error).message}`); continue; }
    if (res.status === 503) { console.log(`\n⛔ Budget/paused (503) — stopping at ${i}/${targets.length} to stay within the Brave cap.`); break; }
    if (!res.ok) { failed++; console.log(`  [${i + 1}] HTTP ${res.status} ${t.title?.slice(0, 40)}`); continue; }
    const after = await NOEV(t.id);
    totalBefore += before; totalAfter += after;
    if (after < before) { improved++; console.log(`  [${i + 1}] ✓ improved  no-evid ${before}→${after}  ${t.title?.slice(0, 40)}`); }
    else { same++; console.log(`  [${i + 1}] · same      no-evid ${before}→${after}  ${t.title?.slice(0, 40)}`); }
  }
  const done = improved + same;
  console.log(`\n=== TIER ${TIER}: ${done} processed — improved ${improved}, same ${same}, failed ${failed} ===`);
  if (done) console.log(`avg "no evidence" notes/book: ${(totalBefore / done).toFixed(1)} → ${(totalAfter / done).toFixed(1)}`);
  process.exit(0);
})();
