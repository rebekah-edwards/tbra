/**
 * Push resolved reported_issues updates to Turso.
 */

import Database from "better-sqlite3";
import path from "path";
import { execSync } from "child_process";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const TURSO_DB = "tbra-web-app";
const TEMP_DIR = path.join(process.cwd(), ".turso-sync-incremental");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

function sqlVal(v: string | null): string {
  if (v === null) return "NULL";
  return `'${v.replace(/'/g, "''")}'`;
}

function main() {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const rows = db
    .prepare(
      `SELECT id, status, resolution, resolved_at
       FROM reported_issues
       WHERE resolved_at > ? OR (status = 'in_progress' AND resolution IS NOT NULL)`,
    )
    .all(since) as { id: string; status: string; resolution: string | null; resolved_at: string | null }[];

  console.log(`Pushing ${rows.length} resolved/in-progress reports`);

  const sqlFile = path.join(TEMP_DIR, "resolved_reports.sql");
  const lines: string[] = ["BEGIN TRANSACTION;"];
  for (const row of rows) {
    lines.push(
      `UPDATE reported_issues SET status = ${sqlVal(row.status)}, resolution = ${sqlVal(row.resolution)}, resolved_at = ${sqlVal(row.resolved_at)} WHERE id = ${sqlVal(row.id)};`,
    );
  }
  lines.push("COMMIT;");
  fs.writeFileSync(sqlFile, lines.join("\n"), "utf-8");

  try {
    execSync(`turso db shell ${TURSO_DB} < "${sqlFile}"`, {
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 120000,
    });
    console.log(`  ✓ Pushed ${rows.length} reports`);
  } catch (err) {
    console.error("  ✗ Failed:", (err as Error).message.slice(0, 300));
  }

  fs.unlinkSync(sqlFile);
  db.close();
}

main();
