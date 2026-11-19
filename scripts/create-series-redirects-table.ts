/**
 * One-off: create `series_redirects` (old series slug/id → current series id)
 * on Turso and the local sqlite. Same shape as author_redirects. Idempotent.
 * Added 2026-11-19 so series slugs can be renamed without 404ing old URLs.
 *
 *   npx tsx scripts/create-series-redirects-table.ts [--local=path/to/tbra.db]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import Database from "better-sqlite3";
import { createGuardedTurso } from "./lib/turso-guard";

const LOCAL_PATH = process.argv.find((a) => a.startsWith("--local="))?.slice(8) ?? "data/tbra.db";
const DDL = [
  `CREATE TABLE IF NOT EXISTS series_redirects (
    old_key TEXT PRIMARY KEY NOT NULL,
    series_id TEXT NOT NULL REFERENCES series(id),
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS series_redirects_series ON series_redirects(series_id)`,
];

(async () => {
  const { remote, shutdown } = await createGuardedTurso({ name: "create-series-redirects-table", maxRuntimeMs: 5 * 60 * 1000 });
  for (const s of DDL) await remote.execute(s);
  console.log("turso: ok", (await remote.execute("SELECT COUNT(*) n FROM series_redirects")).rows[0]);
  const local = new Database(LOCAL_PATH);
  for (const s of DDL) local.exec(s);
  console.log("local: ok", local.prepare("SELECT COUNT(*) n FROM series_redirects").get());
  shutdown();
  process.exit(0);
})();
