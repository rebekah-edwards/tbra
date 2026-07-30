/**
 * fix-onyx-storm-merge.ts
 *
 * Three separate "Onyx Storm" rows were live on prod — three real editions of
 * the same Rebecca Yarros book, each carrying a different user's rating,
 * review and reading session:
 *
 *   38820ad1  onyx-storm-rebecca-yarros     isbn 9781649376947, 544pp, author linked,
 *                                           13 category ratings — but import_only (hidden)
 *   e1213db5  onyx-storm-the-empyrean-3     isbn 9781649377159, 896pp, Entangled,
 *                                           public but NO author link (hence the series slug)
 *   6474c209  onyx-storm-rebecca-yarros-2   isbn 9786059176613, Olimpos Yayınları (Turkish ed.)
 *
 * Target state: ONE public book at the correct slug `onyx-storm-rebecca-yarros`
 * carrying every user's data; the other two editions hidden (import_only) so
 * they leave search and browse.
 *
 * SAFETY — this script never deletes a user row.
 *
 * User data moves with `UPDATE ... SET book_id = canonical`, never the
 * INSERT-OR-IGNORE-then-DELETE pattern that silently destroyed ratings and
 * reviews on 2026-07-30 (see project_dedup_move_destroyed_ratings). Where the
 * same user already holds a row on the canonical book, the duplicate is LEFT IN
 * PLACE on the hidden edition rather than deleted — it becomes invisible, which
 * is the harmless outcome. Deleting it would be the risky one.
 *
 * Local first, then Turso, so a subsequent sync-push cannot re-create what we
 * just hid.
 *
 * Dry-run by default. Pass --apply to mutate.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");

const CANON = "38820ad1-81ef-4f2b-953f-2c02c63e8326";
const DUPES = [
  "e1213db5-cf34-480a-a64f-7b2fe0f89887",
  "6474c209-e50b-43e6-a3f6-0659b4475e5c",
];

/** Tables keyed by (user_id, book_id) that should follow the user to the canonical book. */
const USER_TABLES = [
  "user_book_state",
  "user_book_ratings",
  "user_book_reviews",
  "user_favorite_books",
  "up_next",
  "tbr_notes",
  "shelf_books",
  "user_hidden_books",
  "user_owned_editions",
  "reading_sessions",
  "reading_notes",
];

type Exec = (sql: string, args: any[]) => Promise<{ rows: any[] }>;

async function processSide(label: string, exec: Exec, tableExists: (t: string) => Promise<boolean>) {
  console.log(`\n### ${label}`);

  for (const table of USER_TABLES) {
    if (!(await tableExists(table))) continue;

    // shelf_books is keyed by shelf, not by user; every other table by user_id.
    const ownerCol = table === "shelf_books" ? "shelf_id" : "user_id";

    // Owners who already hold a row on the canonical book — moving a second row
    // for them would collide on the (owner, book_id) uniqueness constraint.
    const canonUsers = new Set(
      (await exec(`SELECT ${ownerCol} FROM ${table} WHERE book_id = ?`, [CANON])).rows.map((r: any) =>
        String(r[ownerCol]),
      ),
    );

    for (const dupe of DUPES) {
      const rows = (await exec(`SELECT ${ownerCol} FROM ${table} WHERE book_id = ?`, [dupe])).rows;
      if (rows.length === 0) continue;

      const movable = rows.filter((r: any) => !canonUsers.has(String(r[ownerCol])));
      const blocked = rows.length - movable.length;

      if (blocked > 0) {
        console.log(
          `  ${table}: ${blocked} row(s) from ${dupe.slice(0, 8)} left in place ` +
            `(user already has one on canonical — not deleted, just hidden with the edition)`,
        );
      }
      if (movable.length === 0) continue;

      if (APPLY) {
        for (const r of movable) {
          await exec(`UPDATE ${table} SET book_id = ? WHERE book_id = ? AND ${ownerCol} = ?`, [
            CANON,
            dupe,
            String(r[ownerCol]),
          ]);
          canonUsers.add(String(r[ownerCol]));
        }
      }
      console.log(
        `  ${table}: ${APPLY ? "moved" : "would move"} ${movable.length} row(s) ` +
          `from ${dupe.slice(0, 8)} -> canonical`,
      );
    }
  }

  // Canonical becomes the public entry; the other editions leave search/browse.
  if (APPLY) {
    const now = new Date().toISOString();
    await exec(`UPDATE books SET visibility = 'public', updated_at = ? WHERE id = ?`, [now, CANON]);
    for (const dupe of DUPES) {
      await exec(`UPDATE books SET visibility = 'import_only', updated_at = ? WHERE id = ?`, [now, dupe]);
    }
    // Canonical has no publisher; the Entangled row does. Fill only if empty.
    await exec(
      `UPDATE books SET publisher = (SELECT publisher FROM books WHERE id = ?) WHERE id = ? AND (publisher IS NULL OR publisher = '')`,
      [DUPES[0], CANON],
    );
  }
  console.log(`  books: canonical -> public, ${DUPES.length} edition(s) -> import_only`);

  // Verify
  const check = await exec(
    `SELECT id, slug, visibility FROM books WHERE id IN (?,?,?)`,
    [CANON, ...DUPES],
  );
  for (const r of check.rows as any[]) {
    console.log(`  verify: ${r.slug} -> ${r.visibility}`);
  }
  for (const table of ["user_book_ratings", "user_book_reviews", "user_book_state"]) {
    if (!(await tableExists(table))) continue;
    const n = (await exec(`SELECT COUNT(*) c FROM ${table} WHERE book_id = ?`, [CANON])).rows[0];
    console.log(`  verify: canonical ${table} = ${(n as any).c}`);
  }
}

async function main() {
  console.log("=== fix-onyx-storm-merge.ts ===");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  // LOCAL first — so a later sync-push cannot resurrect what we hide on prod.
  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  db.pragma("journal_mode = WAL");
  const localExec: Exec = async (sql, args) => {
    if (/^\s*select/i.test(sql)) return { rows: db.prepare(sql).all(...args) as any[] };
    db.prepare(sql).run(...args);
    return { rows: [] };
  };
  const localHas = async (t: string) =>
    !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  await processSide("LOCAL", localExec, localHas);

  const { remote } = await createGuardedTurso({
    name: "fix-onyx-storm-merge",
    maxRuntimeMs: 15 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const remoteExec: Exec = async (sql, args) => {
    const rs = await remote.execute({ sql, args });
    return { rows: rs.rows as any[] };
  };
  const remoteHas = async (t: string) => {
    const rs = await remote.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      args: [t],
    });
    return rs.rows.length > 0;
  };
  await processSide("TURSO", remoteExec, remoteHas);

  if (!APPLY) console.log(`\nDRY-RUN — re-run with --apply to mutate.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
