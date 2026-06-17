/**
 * Merge specific duplicate book pairs into their canonical entry, on BOTH local
 * SQLite and production Turso (user data is bidirectional; sync-push never
 * deletes). Local is applied first so a concurrent sync-push can't re-insert the
 * dupe before Turso is cleaned.
 *
 * For each {canonicalId, dupeId} pair, per DB:
 *   1. Move the dupe's user data onto the canonical (conflict-aware: if the user
 *      already has the canonical, keep the higher-priority shelf state and drop
 *      the dupe row).
 *   2. Delete the dupe's metadata/junction rows.
 *   3. Delete the dupe book row, then VERIFY it's gone.
 *
 * Pairs are hardcoded below (the 2 true dupes found 2026-06-17). Guarded per the
 * Turso-write rule.
 *
 * Usage: npx tsx scripts/merge-book-pair.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import { createClient, Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

const DRY = process.argv.includes("--dry-run");

const PAIRS = [
  // Geektastic anthology — Westerfeld copy (contributor) → Holly Black (editor, has ratings)
  { label: "Geektastic", canonicalId: "4b3c3be5-38f3-45e0-a9b0-5968027301ba", dupeId: "0b78f0de-2c77-4bd0-9a49-3466db8d3a2d" },
  // Leather & Lark — standard edition → Bookish Box exclusive (trilogy-slugged, has ratings)
  { label: "Leather & Lark", canonicalId: "b22e69ad-e0a9-4903-be9e-e7bd6684bf8d", dupeId: "14722cba-d89e-48ec-979c-9fc7561b13e6" },
];

const STATE_PRIORITY: Record<string, number> = {
  finished: 5, reading: 4, paused: 3, up_next: 2, want_to_read: 1, dnf: 0,
};
const sp = (s: string | null) => (s ? STATE_PRIORITY[s] ?? 0 : 0);

// Metadata/junction tables whose dupe rows are simply deleted with the book.
const META_TABLES = [
  "book_authors", "book_genres", "book_series", "book_category_ratings",
  "book_narrators", "links", "editions", "enrichment_log", "reported_issues",
  "report_corrections", "search_index",
];
// User tables to reassign (move dupe rows to canonical, drop on user conflict).
const USER_TABLES_BY_USER = [
  "user_book_ratings", "user_favorite_books", "up_next", "user_hidden_books", "tbr_notes",
];
const USER_TABLES_BY_BOOK = ["reading_sessions", "reading_notes", "user_owned_editions"];

async function tableExists(c: Client, name: string): Promise<boolean> {
  const r = await c.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, args: [name] });
  return r.rows.length > 0;
}

async function mergePairOnClient(c: Client, dbName: string, canonicalId: string, dupeId: string) {
  // 1a. user_book_state — conflict-aware with state-priority upgrade.
  const states = await c.execute({ sql: `SELECT user_id, state FROM user_book_state WHERE book_id=?`, args: [dupeId] });
  for (const row of states.rows) {
    const userId = row.user_id as string;
    const dupeState = row.state as string | null;
    const canon = await c.execute({ sql: `SELECT state FROM user_book_state WHERE book_id=? AND user_id=?`, args: [canonicalId, userId] });
    if (canon.rows.length === 0) {
      if (!DRY) await c.execute({ sql: `UPDATE user_book_state SET book_id=? WHERE book_id=? AND user_id=?`, args: [canonicalId, dupeId, userId] });
      console.log(`    [${dbName}] moved shelf state (user ${userId.slice(0, 8)}) → canonical`);
    } else {
      const canonState = canon.rows[0].state as string | null;
      if (sp(dupeState) > sp(canonState) && !DRY) {
        await c.execute({ sql: `UPDATE user_book_state SET state=? WHERE book_id=? AND user_id=?`, args: [dupeState, canonicalId, userId] });
      }
      if (!DRY) await c.execute({ sql: `DELETE FROM user_book_state WHERE book_id=? AND user_id=?`, args: [dupeId, userId] });
      console.log(`    [${dbName}] user ${userId.slice(0, 8)} already had canonical (state ${canonState}); kept higher of (${canonState}, ${dupeState})`);
    }
  }

  // 1b. reviews: move non-conflicting, else delete dupe review + its children.
  if (await tableExists(c, "user_book_reviews")) {
    const revs = await c.execute({ sql: `SELECT id, user_id FROM user_book_reviews WHERE book_id=?`, args: [dupeId] });
    for (const r of revs.rows) {
      const exists = await c.execute({ sql: `SELECT 1 FROM user_book_reviews WHERE book_id=? AND user_id=?`, args: [canonicalId, r.user_id] });
      if (exists.rows.length === 0) {
        if (!DRY) await c.execute({ sql: `UPDATE user_book_reviews SET book_id=? WHERE id=?`, args: [canonicalId, r.id] });
      } else if (!DRY) {
        await c.execute({ sql: `DELETE FROM user_book_dimension_ratings WHERE review_id=?`, args: [r.id] });
        await c.execute({ sql: `DELETE FROM review_descriptor_tags WHERE review_id=?`, args: [r.id] });
        await c.execute({ sql: `DELETE FROM user_book_reviews WHERE id=?`, args: [r.id] });
      }
      console.log(`    [${dbName}] handled 1 review`);
    }
  }

  // 1c. simple user tables keyed by user_id.
  for (const t of USER_TABLES_BY_USER) {
    if (!(await tableExists(c, t))) continue;
    if (!DRY) {
      await c.execute({ sql: `UPDATE ${t} SET book_id=? WHERE book_id=? AND user_id NOT IN (SELECT user_id FROM ${t} WHERE book_id=?)`, args: [canonicalId, dupeId, canonicalId] });
      await c.execute({ sql: `DELETE FROM ${t} WHERE book_id=?`, args: [dupeId] });
    }
  }
  // 1d. user tables to reassign wholesale by book.
  for (const t of USER_TABLES_BY_BOOK) {
    if (!(await tableExists(c, t))) continue;
    if (!DRY) await c.execute({ sql: `UPDATE ${t} SET book_id=? WHERE book_id=?`, args: [canonicalId, dupeId] });
  }

  // 2. Delete metadata/junction rows.
  for (const t of META_TABLES) {
    if (!(await tableExists(c, t))) continue;
    if (!DRY) await c.execute({ sql: `DELETE FROM ${t} WHERE book_id=?`, args: [dupeId] });
  }

  // 3. Delete the book + verify.
  if (!DRY) {
    await c.execute({ sql: `DELETE FROM books WHERE id=?`, args: [dupeId] });
    const check = await c.execute({ sql: `SELECT 1 FROM books WHERE id=?`, args: [dupeId] });
    if (check.rows.length > 0) throw new Error(`[${dbName}] dupe ${dupeId} STILL EXISTS after delete`);
    console.log(`    [${dbName}] ✓ dupe deleted + verified gone`);
  }
}

(async () => {
  const local = createClient({ url: "file:data/tbra.db" });
  const { remote } = await createGuardedTurso({ name: "merge-book-pair", maxRuntimeMs: 10 * 60 * 1000, queryTimeoutMs: 30_000 });

  for (const p of PAIRS) {
    console.log(`\n### Merge ${p.label}  (dupe ${p.dupeId.slice(0, 8)} → canonical ${p.canonicalId.slice(0, 8)})`);
    console.log(`  -- LOCAL --`);
    await mergePairOnClient(local, "local", p.canonicalId, p.dupeId);
    console.log(`  -- TURSO --`);
    await mergePairOnClient(remote, "turso", p.canonicalId, p.dupeId);
  }
  console.log(`\n${DRY ? "(DRY RUN — nothing written)" : "✓ Merges complete (local + Turso)."}`);
  process.exit(0);
})();
