/**
 * Push junk-description fixes from local SQLite to Turso.
 *
 * The main incremental sync script only inserts new rows — it doesn't push
 * description updates to existing books. After running find-junk-descriptions.ts
 * with --fix, use this script to propagate the changes to production.
 *
 * Strategy: find all books whose description was cleared or salvaged by the
 * junk script (identifiable by recent updated_at), and push those updates to
 * Turso via the turso CLI in batches.
 *
 * Usage:
 *   npx tsx scripts/push-junk-desc-fixes.ts             # push all recent updates
 *   npx tsx scripts/push-junk-desc-fixes.ts --dry-run   # report without pushing
 *   npx tsx scripts/push-junk-desc-fixes.ts --since="2026-04-07 14:00:00"
 */

import Database from "better-sqlite3";
import path from "path";
import { execSync } from "child_process";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SINCE_ARG = args.find((a) => a.startsWith("--since="));
// Default: last 2 hours of updates
const SINCE = SINCE_ARG
  ? SINCE_ARG.split("=")[1]
  : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

const TURSO_DB = "tbra-web-app";
const BATCH_SIZE = 50;

const TEMP_DIR = path.join(process.cwd(), ".turso-sync-incremental");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

function sqlEscape(v: string | null): string {
  if (v === null) return "NULL";
  return `'${v.replace(/'/g, "''")}'`;
}

function main() {
  console.log(`Pushing description updates modified since: ${SINCE}`);
  if (DRY_RUN) console.log("Mode: --dry-run (no changes will be pushed)\n");
  else console.log("Mode: live push\n");

  const rows = db
    .prepare(
      `SELECT id, description, updated_at
       FROM books
       WHERE updated_at > ?
       ORDER BY id`,
    )
    .all(SINCE) as { id: string; description: string | null; updated_at: string }[];

  console.log(`Found ${rows.length.toLocaleString()} books with recent updates`);

  if (rows.length === 0) {
    console.log("Nothing to push.");
    return;
  }

  // Stats
  const cleared = rows.filter((r) => r.description === null).length;
  const updated = rows.filter((r) => r.description !== null).length;
  console.log(`  ${cleared.toLocaleString()} cleared (NULL)`);
  console.log(`  ${updated.toLocaleString()} updated (new text)`);

  if (DRY_RUN) {
    console.log("\nSample (first 3):");
    for (const row of rows.slice(0, 3)) {
      console.log(`  ${row.id} — ${row.description ? row.description.slice(0, 80) + "..." : "NULL"}`);
    }
    return;
  }

  // Push in batches
  let pushed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const sqlFile = path.join(TEMP_DIR, `desc_update_batch_${i}.sql`);
    const lines: string[] = ["BEGIN TRANSACTION;"];
    for (const row of batch) {
      lines.push(
        `UPDATE books SET description = ${sqlEscape(row.description)}, updated_at = ${sqlEscape(row.updated_at)} WHERE id = ${sqlEscape(row.id)};`,
      );
    }
    lines.push("COMMIT;");
    fs.writeFileSync(sqlFile, lines.join("\n"), "utf-8");

    try {
      execSync(`turso db shell ${TURSO_DB} < "${sqlFile}"`, {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 120000,
      });
      pushed += batch.length;
      process.stdout.write(`\r  Pushed: ${pushed.toLocaleString()}/${rows.length.toLocaleString()}`);
    } catch (err) {
      failed += batch.length;
      console.error(`\n  ✗ Batch ${i} failed:`, (err as Error).message.slice(0, 200));
    }

    fs.unlinkSync(sqlFile);
  }

  console.log(`\n\nDone. Pushed ${pushed.toLocaleString()}, failed ${failed.toLocaleString()}.`);
  db.close();
}

main();
