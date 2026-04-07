/**
 * Push backfilled author slugs to Turso.
 *
 * The incremental sync doesn't update existing authors. After running
 * backfill-author-slugs.ts locally, use this to propagate the slugs to
 * production.
 */

import Database from "better-sqlite3";
import path from "path";
import { execSync } from "child_process";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const TURSO_DB = "tbra-web-app";
const BATCH_SIZE = 100;
const TEMP_DIR = path.join(process.cwd(), ".turso-sync-incremental");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

function sqlVal(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function main() {
  const rows = db
    .prepare("SELECT id, slug FROM authors WHERE slug IS NOT NULL AND slug != ''")
    .all() as { id: string; slug: string }[];

  console.log(`Found ${rows.length.toLocaleString()} authors with slugs to push`);

  let pushed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const sqlFile = path.join(TEMP_DIR, `author_slug_batch_${i}.sql`);
    const lines: string[] = ["BEGIN TRANSACTION;"];
    for (const row of batch) {
      lines.push(`UPDATE authors SET slug = ${sqlVal(row.slug)} WHERE id = ${sqlVal(row.id)};`);
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
