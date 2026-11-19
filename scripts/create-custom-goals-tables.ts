/**
 * Creates the premium custom-goals tables (2026-11-19) on production Turso
 * AND the local SQLite, idempotently. Tables must exist on Turso BEFORE the
 * code that reads them deploys.
 *
 *   npx tsx scripts/create-custom-goals-tables.ts
 */
import path from "path";
import Database from "better-sqlite3";
import { config } from "dotenv";
import { createGuardedTurso } from "./lib/turso-guard";

config({ path: path.join(process.cwd(), ".env.vercel.local") });

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS custom_goals (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    year INTEGER NOT NULL,
    kind TEXT NOT NULL,
    genre_name TEXT,
    goal_key TEXT NOT NULL,
    target INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS custom_goals_user_year_key_unique
     ON custom_goals (user_id, year, goal_key)`,
  `CREATE TABLE IF NOT EXISTS user_audio_lengths (
    user_id TEXT NOT NULL REFERENCES users(id),
    book_id TEXT NOT NULL REFERENCES books(id),
    minutes INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, book_id)
  )`,
];

(async () => {
  const { remote, shutdown } = await createGuardedTurso({
    name: "create-custom-goals-tables",
    maxRuntimeMs: 2 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  for (const s of STATEMENTS) await remote.execute(s);
  const remoteCheck = await remote.execute(
    "SELECT name FROM sqlite_master WHERE name IN ('custom_goals','user_audio_lengths','custom_goals_user_year_key_unique') ORDER BY name",
  );
  console.log("Turso:", remoteCheck.rows.map((r) => r.name).join(", "));

  const dbPath = process.env.LOCAL_DB_PATH || path.join(process.cwd(), "data", "tbra.db");
  const local = new Database(dbPath);
  for (const s of STATEMENTS) local.exec(s);
  const localCheck = local
    .prepare("SELECT name FROM sqlite_master WHERE name IN ('custom_goals','user_audio_lengths','custom_goals_user_year_key_unique') ORDER BY name")
    .all() as { name: string }[];
  console.log(`Local (${dbPath}):`, localCheck.map((r) => r.name).join(", "));
  local.close();

  await shutdown?.();
  process.exit(0);
})();
