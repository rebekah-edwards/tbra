/**
 * Merge the "held — same-user collision" dupe pairs that the weekly
 * replay-dedup-both run skips, on BOTH local SQLite and production Turso.
 *
 * These are pairs where one user has rows on the dupe AND the canonical, so the
 * INSERT-OR-IGNORE move in the standard applier would silently destroy the
 * dupe's copy. Here every conflict is resolved explicitly:
 *
 *   - user_book_state   : keep the higher-priority shelf state (real vocabulary;
 *                         merge-book-pair.ts's map is stale and scores every
 *                         real state 0).
 *   - user_book_ratings : keep the MOST RECENT rating by updated_at
 *                         (Rebekah's call, 2026-08-08).
 *   - user_book_reviews : move when the canonical has none; else keep the
 *                         canonical's and drop the dupe's + its children.
 *
 * Local is applied first so a concurrent sync-push can't re-insert the dupe
 * before Turso is cleaned. Guarded per the Turso-write rule.
 *
 * Usage: npx tsx scripts/merge-held-dupe-pairs.ts [--apply]   (default dry-run)
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import { createClient, Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const PAIRS_FILE = process.argv.find((a) => a.startsWith("--pairs="))?.split("=")[1];
if (!PAIRS_FILE) throw new Error("--pairs=<path to pairs.json> is required");

const PAIRS: { label: string; canonicalId: string; dupeId: string }[] = JSON.parse(
  readFileSync(PAIRS_FILE, "utf8"),
);

// Real state vocabulary (verified against user_book_state 2026-08-08).
const STATE_PRIORITY: Record<string, number> = {
  completed: 5, currently_reading: 4, paused: 3, dnf: 2, tbr: 1,
};
const sp = (s: string | null) => (s ? STATE_PRIORITY[s] ?? 0 : 0);

/** Timestamps come in both "YYYY-MM-DD HH:MM:SS" and ISO-Z form. */
function ts(v: unknown): number {
  if (!v) return 0;
  const n = Date.parse(String(v).replace(" ", "T"));
  return Number.isNaN(n) ? 0 : n;
}

const META_TABLES = [
  "book_authors", "book_genres", "book_series", "book_category_ratings",
  "book_narrators", "links", "editions", "enrichment_log", "reported_issues",
  "report_corrections", "search_index",
];
const USER_TABLES_BY_USER = [
  "user_favorite_books", "up_next", "user_hidden_books", "tbr_notes",
];
// Moved wholesale by book. Those with a UNIQUE index spanning book_id need the
// move restricted to non-colliding rows, or the UPDATE aborts the whole run:
//   reading_sessions      UNIQUE(user_id, book_id, read_number)
//   user_owned_editions   UNIQUE(user_id, book_id, edition_id, format)
const USER_TABLES_BY_BOOK: { table: string; keyCols: string[] }[] = [
  { table: "reading_sessions", keyCols: ["user_id", "read_number"] },
  { table: "reading_notes", keyCols: [] },
  { table: "user_owned_editions", keyCols: ["user_id", "edition_id", "format"] },
];

async function tableExists(c: Client, name: string): Promise<boolean> {
  const r = await c.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, args: [name] });
  return r.rows.length > 0;
}

async function mergePairOnClient(c: Client, dbName: string, canonicalId: string, dupeId: string) {
  // 1a. Shelf state — conflict-aware, real priority map.
  const states = await c.execute({ sql: `SELECT user_id, state FROM user_book_state WHERE book_id=?`, args: [dupeId] });
  for (const row of states.rows) {
    const userId = row.user_id as string;
    const dupeState = row.state as string | null;
    const canon = await c.execute({ sql: `SELECT state FROM user_book_state WHERE book_id=? AND user_id=?`, args: [canonicalId, userId] });
    if (canon.rows.length === 0) {
      if (APPLY) await c.execute({ sql: `UPDATE user_book_state SET book_id=? WHERE book_id=? AND user_id=?`, args: [canonicalId, dupeId, userId] });
      console.log(`    [${dbName}] state: moved (user ${userId.slice(0, 8)}, ${dupeState})`);
    } else {
      const canonState = canon.rows[0].state as string | null;
      const upgrade = sp(dupeState) > sp(canonState);
      if (upgrade && APPLY) {
        await c.execute({
          sql: `UPDATE user_book_state SET state=?, updated_at=? WHERE book_id=? AND user_id=?`,
          args: [dupeState, new Date().toISOString(), canonicalId, userId],
        });
      }
      if (APPLY) await c.execute({ sql: `DELETE FROM user_book_state WHERE book_id=? AND user_id=?`, args: [dupeId, userId] });
      console.log(`    [${dbName}] state: conflict (user ${userId.slice(0, 8)}) canon=${canonState} dupe=${dupeState} → kept ${upgrade ? dupeState : canonState}`);
    }
  }

  // 1b. Ratings — keep the most recent by updated_at.
  const rates = await c.execute({ sql: `SELECT user_id, rating, updated_at FROM user_book_ratings WHERE book_id=?`, args: [dupeId] });
  for (const row of rates.rows) {
    const userId = row.user_id as string;
    const canon = await c.execute({ sql: `SELECT rating, updated_at FROM user_book_ratings WHERE book_id=? AND user_id=?`, args: [canonicalId, userId] });
    if (canon.rows.length === 0) {
      if (APPLY) await c.execute({ sql: `UPDATE user_book_ratings SET book_id=? WHERE book_id=? AND user_id=?`, args: [canonicalId, dupeId, userId] });
      console.log(`    [${dbName}] rating: moved (user ${userId.slice(0, 8)}, ${row.rating})`);
    } else {
      const dupeNewer = ts(row.updated_at) > ts(canon.rows[0].updated_at);
      if (dupeNewer && APPLY) {
        await c.execute({
          sql: `UPDATE user_book_ratings SET rating=?, updated_at=? WHERE book_id=? AND user_id=?`,
          args: [row.rating, row.updated_at, canonicalId, userId],
        });
      }
      if (APPLY) await c.execute({ sql: `DELETE FROM user_book_ratings WHERE book_id=? AND user_id=?`, args: [dupeId, userId] });
      console.log(`    [${dbName}] rating: conflict (user ${userId.slice(0, 8)}) canon=${canon.rows[0].rating}@${canon.rows[0].updated_at} dupe=${row.rating}@${row.updated_at} → kept ${dupeNewer ? row.rating : canon.rows[0].rating}`);
    }
  }

  // 1c. Reviews — move non-conflicting, else drop the dupe's + children.
  if (await tableExists(c, "user_book_reviews")) {
    const revs = await c.execute({ sql: `SELECT id, user_id FROM user_book_reviews WHERE book_id=?`, args: [dupeId] });
    for (const r of revs.rows) {
      const exists = await c.execute({ sql: `SELECT 1 FROM user_book_reviews WHERE book_id=? AND user_id=?`, args: [canonicalId, r.user_id] });
      if (exists.rows.length === 0) {
        if (APPLY) await c.execute({ sql: `UPDATE user_book_reviews SET book_id=? WHERE id=?`, args: [canonicalId, r.id] });
        console.log(`    [${dbName}] review: moved (user ${String(r.user_id).slice(0, 8)})`);
      } else {
        if (APPLY) {
          await c.execute({ sql: `DELETE FROM user_book_dimension_ratings WHERE review_id=?`, args: [r.id] });
          await c.execute({ sql: `DELETE FROM review_descriptor_tags WHERE review_id=?`, args: [r.id] });
          await c.execute({ sql: `DELETE FROM user_book_reviews WHERE id=?`, args: [r.id] });
        }
        console.log(`    [${dbName}] review: conflict (user ${String(r.user_id).slice(0, 8)}) → kept canonical's`);
      }
    }
  }

  // 1d. Remaining user tables keyed by user_id.
  for (const t of USER_TABLES_BY_USER) {
    if (!(await tableExists(c, t))) continue;
    if (APPLY) {
      await c.execute({ sql: `UPDATE ${t} SET book_id=? WHERE book_id=? AND user_id NOT IN (SELECT user_id FROM ${t} WHERE book_id=?)`, args: [canonicalId, dupeId, canonicalId] });
      await c.execute({ sql: `DELETE FROM ${t} WHERE book_id=?`, args: [dupeId] });
    }
  }
  for (const { table: t, keyCols } of USER_TABLES_BY_BOOK) {
    if (!(await tableExists(c, t))) continue;
    if (!APPLY) continue;
    if (keyCols.length === 0) {
      await c.execute({ sql: `UPDATE ${t} SET book_id=? WHERE book_id=?`, args: [canonicalId, dupeId] });
      continue;
    }
    // `IS` (not `=`) so NULL key parts still count as a collision.
    const match = keyCols.map((k) => `x.${k} IS ${t}.${k}`).join(" AND ");
    const moved = await c.execute({
      sql: `UPDATE ${t} SET book_id=? WHERE book_id=?
              AND NOT EXISTS (SELECT 1 FROM ${t} x WHERE x.book_id=? AND ${match})`,
      args: [canonicalId, dupeId, canonicalId],
    });
    // Whatever remains on the dupe collided with an existing canonical row.
    const dropped = await c.execute({ sql: `DELETE FROM ${t} WHERE book_id=?`, args: [dupeId] });
    if (Number(moved.rowsAffected) || Number(dropped.rowsAffected)) {
      console.log(`    [${dbName}] ${t}: moved ${moved.rowsAffected}, dropped ${dropped.rowsAffected} colliding`);
    }
  }

  // 2. Metadata/junction rows.
  for (const t of META_TABLES) {
    if (!(await tableExists(c, t))) continue;
    if (APPLY) await c.execute({ sql: `DELETE FROM ${t} WHERE book_id=?`, args: [dupeId] });
  }

  // 3. Book row + verify.
  if (APPLY) {
    await c.execute({ sql: `DELETE FROM books WHERE id=?`, args: [dupeId] });
    const check = await c.execute({ sql: `SELECT 1 FROM books WHERE id=?`, args: [dupeId] });
    if (check.rows.length > 0) throw new Error(`[${dbName}] dupe ${dupeId} STILL EXISTS after delete`);
    console.log(`    [${dbName}] ✓ dupe deleted + verified gone`);
  }
}

(async () => {
  const local = createClient({ url: "file:data/tbra.db" });
  const { remote, shutdown } = await createGuardedTurso({
    name: "merge-held-dupe-pairs",
    maxRuntimeMs: 30 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  console.log(`=== merge-held-dupe-pairs ===\nMode: ${APPLY ? "APPLY" : "DRY-RUN"}\nPairs: ${PAIRS.length}\n`);

  for (const p of PAIRS) {
    console.log(`\n### ${p.label}  (dupe ${p.dupeId.slice(0, 8)} → canonical ${p.canonicalId.slice(0, 8)})`);
    console.log(`  -- LOCAL --`);
    await mergePairOnClient(local, "local", p.canonicalId, p.dupeId);
    console.log(`  -- TURSO --`);
    await mergePairOnClient(remote, "turso", p.canonicalId, p.dupeId);
  }

  console.log(`\n${APPLY ? "✓ Applied" : "DRY-RUN complete. Re-run with --apply."}`);
  if (typeof shutdown === "function") await shutdown();
  process.exit(0);
})();
