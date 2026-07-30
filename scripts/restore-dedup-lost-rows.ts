/**
 * restore-dedup-lost-rows.ts — 2026-07-30 recovery.
 *
 * Restores user ratings/reviews that replay-dedup-both DESTROYED (it moved rows with
 * INSERT OR IGNORE + DELETE, which silently annihilated every row in a table with a
 * surrogate `id` PK — see project_dedup_move_destroyed_ratings in memory).
 *
 * Source of truth: a PITR fork of prod taken at 2026-07-30T18:45:00Z (pre-merge), diffed
 * against current prod into reports/dedup-lost-rows-2026-07-30.json. Each row is re-inserted
 * with its ORIGINAL id and column values, re-pointed at the surviving canonical book.
 *
 * Safety: skips any row whose owner already has a row for that (table, canonical book) —
 * we never overwrite what a user has since created — and skips the clanker test account.
 * Verifies every insert. Dry-run by default; pass --apply.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const MANIFEST =
  process.argv.find((a) => a.startsWith("--manifest="))?.split("=")[1] ??
  path.join("reports", "dedup-lost-rows-2026-07-30.json");
const LOST = JSON.parse(fs.readFileSync(path.join(process.cwd(), MANIFEST), "utf8")) as {
  table: string;
  row: Record<string, unknown>;
  canonicalId: string;
  email?: string;
}[];

(async () => {
  const { remote } = await createGuardedTurso({
    name: "restore-dedup-lost-rows",
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));
  local.pragma("busy_timeout = 30000");

  let restoredProd = 0, restoredLocal = 0, skipped = 0;

  for (const item of LOST) {
    const { table, canonicalId } = item;
    const row = { ...item.row, book_id: canonicalId };
    const userId = row.user_id as string;

    if (String(item.email ?? "").includes("clanker")) {
      console.log(`  SKIP (test account) ${table} ${item.email}`);
      skipped++;
      continue;
    }

    // Never clobber a row the user has created since the loss.
    const conflict = await remote.execute({
      sql: `SELECT 1 FROM ${table} WHERE book_id = ? AND user_id = ?`,
      args: [canonicalId, userId],
    });
    if (conflict.rows.length > 0) {
      console.log(`  SKIP (user already has a row) ${table} ${item.email}`);
      skipped++;
      continue;
    }

    const cols = Object.keys(row);
    const placeholders = cols.map(() => "?").join(", ");
    const values = cols.map((c) => row[c] as never);

    if (APPLY) {
      await remote.execute({
        sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
        args: values,
      });
      const v = await remote.execute({ sql: `SELECT 1 FROM ${table} WHERE id = ?`, args: [row.id as string] });
      if (v.rows.length === 0) throw new Error(`PROD verify failed for ${table} id=${row.id}`);
      restoredProd++;

      // Keep local in step so the next sync doesn't have to reconcile it.
      const existsLocal = local.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(row.id as string);
      const conflictLocal = local
        .prepare(`SELECT 1 FROM ${table} WHERE book_id = ? AND user_id = ?`)
        .get(canonicalId, userId);
      if (!existsLocal && !conflictLocal) {
        local.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
        restoredLocal++;
      }
    }
    console.log(`  ${APPLY ? "RESTORED" : "would restore"} ${table.padEnd(19)} ${item.email}`);
  }

  console.log(`\n=== ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
  console.log(`  restored to prod:  ${restoredProd}`);
  console.log(`  restored to local: ${restoredLocal}`);
  console.log(`  skipped:           ${skipped}`);
  if (!APPLY) console.log("\nDRY-RUN. Re-run with --apply.");
  local.close();
  process.exit(0);
})();
