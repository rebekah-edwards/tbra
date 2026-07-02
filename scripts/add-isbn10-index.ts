/**
 * One-off: add idx_books_isbn10 on Turso + local.
 *
 * The ISBNdb search fallback dedups with `isbn_13 IN (...) OR isbn_10 IN (...)`.
 * isbn_13 has a unique index but isbn_10 had none, so SQLite can't use the
 * OR-optimization and full-scans books (~64k rows, 100s+ on Turso) — the
 * remaining cause of /api/search/full 504s after the title-index fix.
 */
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.vercel.local" });

(async () => {
  const { remote } = await createGuardedTurso({
    name: "add-isbn10-index",
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 300_000, // index build scans the table once
  });

  console.log("Creating idx_books_isbn10 on Turso...");
  await remote.execute(`CREATE INDEX IF NOT EXISTS idx_books_isbn10 ON books(isbn_10)`);
  const check = await remote.execute(
    `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_books_isbn10'`,
  );
  console.log(`Turso: ${check.rows.length ? "created" : "MISSING"}`);

  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));
  local.exec(`CREATE INDEX IF NOT EXISTS idx_books_isbn10 ON books(isbn_10)`);
  const lcheck = local
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_books_isbn10'`)
    .get();
  console.log(`Local: ${lcheck ? "created" : "MISSING"}`);
  local.close();
  process.exit(0);
})();
