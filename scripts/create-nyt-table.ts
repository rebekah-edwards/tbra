/**
 * One-time DDL: create the `nyt_bestsellers` cache table on BOTH local SQLite and
 * production Turso (schema must land on Turso before code that reads it ships).
 * Idempotent — safe to re-run.
 */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env.vercel.local" });

import { createGuardedTurso } from "./lib/turso-guard";
import path from "path";

const DDL = [
  `CREATE TABLE IF NOT EXISTS nyt_bestsellers (
    id text PRIMARY KEY NOT NULL,
    isbn_13 text,
    isbn_10 text,
    title text NOT NULL,
    author text,
    title_key text,
    description text,
    publisher text,
    book_image text,
    amazon_url text,
    first_list_name text,
    best_rank integer,
    weeks_on_list integer,
    first_published_date text,
    captured_at text NOT NULL DEFAULT (datetime('now')),
    updated_at text NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS nyt_isbn13_unique ON nyt_bestsellers (isbn_13)`,
  `CREATE INDEX IF NOT EXISTS nyt_title_key_idx ON nyt_bestsellers (title_key)`,
];

(async () => {
  // ── Local ──
  const Database = require("better-sqlite3");
  const localPath = path.join(process.cwd(), "data", "tbra.db");
  const local = new Database(localPath);
  for (const stmt of DDL) local.exec(stmt);
  const lc = local.prepare("SELECT COUNT(*) AS n FROM nyt_bestsellers").get() as { n: number };
  console.log(`LOCAL  nyt_bestsellers ready — rows: ${lc.n}`);
  local.close();

  // ── Turso (guarded) ──
  const { remote } = await createGuardedTurso({
    name: "create-nyt-table",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  for (const stmt of DDL) await remote.execute({ sql: stmt, args: [] });
  const rc = await remote.execute({ sql: "SELECT COUNT(*) AS n FROM nyt_bestsellers", args: [] });
  console.log(`TURSO  nyt_bestsellers ready — rows: ${rc.rows[0].n}`);
  process.exit(0);
})().catch((err) => {
  console.error("create-nyt-table failed:", err);
  process.exit(1);
});
