/**
 * Archive a user's complete footprint from the LOCAL mirror to a JSON file.
 *
 * Why: when someone deletes their account on production, `users` is pull-only
 * (sync-user-activity marks it noPush), so the local Mac copy keeps their whole
 * library indefinitely — the last surviving copy of their data. That is both a
 * restore path if the deletion turns out to have been a bug, and a retention
 * problem if it was deliberate. This script captures the restore path so the
 * local rows can then be cleared safely.
 *
 * Export only. It NEVER deletes anything — clearing is a separate deliberate
 * step (scripts/purge-archived-account.ts) that refuses to run without a
 * verified archive on disk.
 *
 *   npx tsx scripts/archive-user-account.ts <email-or-user-id> [more…]
 *
 * Writes data/account-archives/<username>-<userid>-<date>.json and re-reads it
 * to verify every table's row count round-trips.
 */

import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.vercel.local"), override: true });

import { createClient } from "@libsql/client";

const OUT_DIR = path.resolve(process.cwd(), "data/account-archives");

async function main() {
  const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!targets.length) {
    console.error("usage: archive-user-account.ts <email-or-user-id> [more…]");
    process.exit(1);
  }

  const local = createClient({ url: "file:data/tbra.db" });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Every table carrying a reference to a user, discovered from the schema so
  // this cannot drift as tables are added.
  const tables = (
    await local.execute(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%'",
    )
  ).rows.map((r) => r.name as string);

  const userTables: { table: string; cols: string[] }[] = [];
  for (const t of tables) {
    if (t === "users") continue;
    const cols = (await local.execute({ sql: "select name from pragma_table_info(?)", args: [t] }))
      .rows.map((r) => r.name as string);
    const uc = cols.filter((c) =>
      /^(user_id|follower_id|followed_id|created_by|owner_id|referred_by_user_id)$/.test(c),
    );
    if (uc.length) userTables.push({ table: t, cols: uc });
  }

  for (const target of targets) {
    const userRow = (
      await local.execute({
        sql: "select * from users where id = ? or lower(email) = lower(?)",
        args: [target, target],
      })
    ).rows[0] as Record<string, unknown> | undefined;

    if (!userRow) {
      console.error(`  !! no local user matching "${target}" — skipped`);
      continue;
    }
    const uid = userRow.id as string;
    const uname = (userRow.username as string) ?? "unknown";
    console.log(`\n=== ${userRow.email} (${uname}) ${uid} ===`);

    const data: Record<string, Record<string, unknown>[]> = {};
    let total = 0;
    for (const { table, cols } of userTables) {
      const where = cols.map((c) => `${c} = ?`).join(" OR ");
      const rows = (
        await local.execute({ sql: `select * from ${table} where ${where}`, args: cols.map(() => uid) })
      ).rows.map((r) => ({ ...r }) as Record<string, unknown>);
      if (rows.length) {
        data[table] = rows;
        total += rows.length;
        console.log(`  ${table.padEnd(34)} ${String(rows.length).padStart(6)}`);
      }
    }

    const archive = {
      schemaVersion: 1,
      archivedAt: new Date().toISOString(),
      source: "local mirror data/tbra.db",
      note:
        "Complete footprint of a user whose production account no longer exists. " +
        "Restoring requires recreating the users row FIRST (FKs are on user_id).",
      user: userRow,
      rowCounts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      totalRows: total,
      data,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    const file = path.join(OUT_DIR, `${uname}-${uid.slice(0, 8)}-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(archive, null, 2));

    // Verify: re-read from disk and confirm every count round-trips.
    const back = JSON.parse(fs.readFileSync(file, "utf8"));
    let ok = back.user?.id === uid && back.totalRows === total;
    for (const [t, n] of Object.entries(archive.rowCounts)) {
      if ((back.data[t]?.length ?? -1) !== n) { ok = false; console.error(`  MISMATCH ${t}`); }
    }
    const size = (fs.statSync(file).size / 1024).toFixed(0);
    console.log(`  → ${file}`);
    console.log(`  ${total} rows across ${Object.keys(data).length} tables, ${size} KB — verify ${ok ? "PASSED" : "FAILED"}`);
    if (!ok) process.exitCode = 1;
  }

  process.exit(process.exitCode ?? 0);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
