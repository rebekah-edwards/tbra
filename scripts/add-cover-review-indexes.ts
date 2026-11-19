/**
 * One-off: indexes behind /admin/covers, on Turso + local.
 *
 * The cover review queue ("public books with no cover", ranked by how many
 * readers have each one) took 40s-4min+ on Turso and timed the page out:
 *   - user_book_state had no book_id index, so every "how many readers"
 *     lookup scanned all ~17.6k rows, once per coverless book (~9.7k);
 *   - "public AND cover missing" walked all ~84k public book rows (wide rows,
 *     ~26s from cold storage) to find the ~9.7k without a cover.
 * idx_books_public_missing_cover is a small partial covering index over
 * exactly that set; the page pins it with INDEXED BY.
 */
import Database from "better-sqlite3";
import { createGuardedTurso } from "./lib/turso-guard";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.vercel.local" });

const STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_user_book_state_book ON user_book_state(book_id)`,
  `CREATE INDEX IF NOT EXISTS idx_books_public_missing_cover
     ON books(created_at, id, visibility, cover_image_url)
     WHERE visibility = 'public' AND (cover_image_url IS NULL OR cover_image_url = '')`,
];
const NAMES = ["idx_user_book_state_book", "idx_books_public_missing_cover"];

(async () => {
  const { remote } = await createGuardedTurso({
    name: "add-cover-review-indexes",
    maxRuntimeMs: 15 * 60 * 1000,
    queryTimeoutMs: 600_000, // each build scans its table once
  });

  for (const s of STATEMENTS) {
    const t = Date.now();
    await remote.execute(s);
    console.log(`Turso: ${s.split("\n")[0]} (${Date.now() - t}ms)`);
  }
  for (const n of NAMES) {
    const r = await remote.execute(`SELECT name FROM sqlite_master WHERE type='index' AND name='${n}'`);
    console.log(`Turso ${n}: ${r.rows.length ? "present" : "MISSING"}`);
  }

  const localPath = process.env.LOCAL_DB_PATH ?? "/Users/clankeredwards/claude/tbra/data/tbra.db";
  const local = new Database(localPath);
  for (const s of STATEMENTS) local.exec(s);
  for (const n of NAMES) {
    const r = local.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`).get(n);
    console.log(`Local ${n}: ${r ? "present" : "MISSING"}`);
  }
  local.close();
  process.exit(0);
})();
