/**
 * Push all recent book row updates to Turso (full row, not just description).
 *
 * The main incremental sync script only inserts new rows. This one handles
 * field updates on existing books (cover changes, visibility flips, year/date
 * fixes, is_box_set, description, etc.) — anything touched by admin scripts
 * or scheduled enrichment runs that needs to propagate to production.
 *
 * Usage:
 *   npx tsx scripts/push-recent-book-updates.ts                  # last 2h
 *   npx tsx scripts/push-recent-book-updates.ts --dry-run        # no changes
 *   npx tsx scripts/push-recent-book-updates.ts --since="2026-04-07 20:00"
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
const SINCE = SINCE_ARG
  ? SINCE_ARG.split("=")[1]
  : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

const TURSO_DB = "tbra-web-app";
const BATCH_SIZE = 30;

// Columns to sync. Keep this list small — only fields that routinely need updating.
const SYNC_COLS = [
  "title",
  "slug",
  "description",
  "summary",
  "cover_image_url",
  "cover_source",
  "cover_verified",
  "audiobook_cover_url",
  "publication_year",
  "publication_date",
  "pages",
  "publisher",
  "language",
  "is_fiction",
  "is_box_set",
  "visibility",
  "updated_at",
];

const TEMP_DIR = path.join(process.cwd(), ".turso-sync-incremental");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

function sqlVal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function main() {
  console.log(`Pushing book row updates modified since: ${SINCE}`);
  if (DRY_RUN) console.log("Mode: --dry-run (no changes will be pushed)\n");

  const rows = db
    .prepare(
      `SELECT id, ${SYNC_COLS.join(", ")}
       FROM books
       WHERE updated_at > ?
       ORDER BY id`,
    )
    .all(SINCE) as Record<string, unknown>[];

  console.log(`Found ${rows.length.toLocaleString()} books with recent updates`);
  if (rows.length === 0) {
    console.log("Nothing to push.");
    return;
  }

  if (DRY_RUN) {
    console.log("\nSample (first 3):");
    for (const row of rows.slice(0, 3)) {
      console.log(`  ${row.id} — "${String(row.title).slice(0, 60)}"  visibility=${row.visibility}`);
    }
    return;
  }

  let pushed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const sqlFile = path.join(TEMP_DIR, `book_update_batch_${i}.sql`);
    const lines: string[] = ["BEGIN TRANSACTION;"];
    for (const row of batch) {
      const setPairs = SYNC_COLS.map((col) => `${col} = ${sqlVal(row[col])}`).join(", ");
      lines.push(`UPDATE books SET ${setPairs} WHERE id = ${sqlVal(row.id)};`);
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
