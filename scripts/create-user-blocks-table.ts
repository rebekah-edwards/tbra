/**
 * One-time migration: create `user_blocks` on production Turso and on the
 * local SQLite mirror. Idempotent (CREATE ... IF NOT EXISTS), safe to re-run.
 *
 * WHY: App Review guideline 1.2 requires an app with user-generated content
 * to let a reader block an abusive user. A row means "blocker no longer sees
 * blocked, and blocked no longer sees blocker" — see src/lib/queries/blocks.ts.
 *
 * Per CLAUDE.md the table must exist on Turso BEFORE code that reads it
 * deploys, and every Turso-writing script goes through createGuardedTurso.
 *
 *   npx tsx scripts/create-user-blocks-table.ts
 */
import * as path from "path";
import * as dotenv from "dotenv";
import Database from "better-sqlite3";
import { createGuardedTurso } from "./lib/turso-guard";

dotenv.config({ path: path.join(__dirname, "..", ".env.vercel.local") });

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_blocks (
     blocker_id TEXT NOT NULL REFERENCES users(id),
     blocked_id TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_unique ON user_blocks (blocker_id, blocked_id)`,
  `CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks (blocked_id)`,
];

(async () => {
  const { remote } = await createGuardedTurso({
    name: "create-user-blocks-table",
    maxRuntimeMs: 2 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  for (const sql of STATEMENTS) await remote.execute(sql);
  const check = await remote.execute(
    `SELECT name FROM sqlite_master WHERE name IN ('user_blocks','user_blocks_unique','user_blocks_blocked_idx') ORDER BY name`
  );
  console.log("Turso:", check.rows.map((r) => r.name).join(", "));

  const local = new Database(path.join(__dirname, "..", "data", "tbra.db"));
  local.pragma("busy_timeout = 8000");
  for (const sql of STATEMENTS) local.exec(sql);
  const localCheck = local
    .prepare(`SELECT name FROM sqlite_master WHERE name IN ('user_blocks','user_blocks_unique','user_blocks_blocked_idx') ORDER BY name`)
    .all() as { name: string }[];
  console.log("Local:", localCheck.map((r) => r.name).join(", "));
  local.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
