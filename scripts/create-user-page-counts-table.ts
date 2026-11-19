/**
 * Creates user_page_counts (2026-11-19) on production Turso AND the local
 * SQLite, idempotently — before the code that reads it deploys.
 *
 *   npx tsx scripts/create-user-page-counts-table.ts
 */
import path from "path";
import Database from "better-sqlite3";
import { config } from "dotenv";
import { createGuardedTurso } from "./lib/turso-guard";

config({ path: path.join(process.cwd(), ".env.vercel.local") });

const STATEMENT = `CREATE TABLE IF NOT EXISTS user_page_counts (
  user_id TEXT NOT NULL REFERENCES users(id),
  book_id TEXT NOT NULL REFERENCES books(id),
  pages INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id)
)`;

(async () => {
  const { remote, shutdown } = await createGuardedTurso({
    name: "create-user-page-counts-table",
    maxRuntimeMs: 2 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  await remote.execute(STATEMENT);
  const r = await remote.execute("SELECT name FROM sqlite_master WHERE name = 'user_page_counts'");
  console.log("Turso:", r.rows.map((x) => x.name).join(", ") || "MISSING");

  const dbPath = process.env.LOCAL_DB_PATH || path.join(process.cwd(), "data", "tbra.db");
  const local = new Database(dbPath);
  local.exec(STATEMENT);
  const l = local.prepare("SELECT name FROM sqlite_master WHERE name = 'user_page_counts'").all() as { name: string }[];
  console.log(`Local (${dbPath}):`, l.map((x) => x.name).join(", ") || "MISSING");
  local.close();
  await shutdown?.();
  process.exit(0);
})();
