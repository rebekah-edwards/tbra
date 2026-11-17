/**
 * One-time migration: columns on `users` for Apple In-App Purchase
 * subscriptions. Idempotent (skips a column that already exists).
 *
 *   premium_source                 'apple' | 'stripe' | NULL — who is paying
 *                                  for a 'premium' account, so one biller's
 *                                  cancellation never downgrades the other's
 *                                  subscriber.
 *   apple_original_transaction_id  the subscription's stable id across
 *                                  renewals; how Apple's server notifications
 *                                  find the account.
 *   apple_expires_at               ISO time the current Apple period ends.
 *
 * Runs against production Turso (guarded) and the local SQLite mirror.
 * Per CLAUDE.md the columns must exist on Turso BEFORE code that reads them
 * deploys.   npx tsx scripts/add-apple-iap-columns.ts
 */
import * as path from "path";
import * as dotenv from "dotenv";
import Database from "better-sqlite3";
import { createGuardedTurso } from "./lib/turso-guard";

dotenv.config({ path: path.join(__dirname, "..", ".env.vercel.local") });

const COLUMNS = ["premium_source", "apple_original_transaction_id", "apple_expires_at"];
const INDEX = `CREATE INDEX IF NOT EXISTS users_apple_original_tx_idx ON users (apple_original_transaction_id)`;

(async () => {
  const { remote } = await createGuardedTurso({
    name: "add-apple-iap-columns",
    maxRuntimeMs: 2 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  const have = new Set((await remote.execute(`PRAGMA table_info(users)`)).rows.map((r) => String(r.name)));
  for (const col of COLUMNS) {
    if (have.has(col)) { console.log(`Turso: ${col} already there`); continue; }
    await remote.execute(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
    console.log(`Turso: added ${col}`);
  }
  await remote.execute(INDEX);

  const local = new Database(path.join(__dirname, "..", "data", "tbra.db"));
  local.pragma("busy_timeout = 8000");
  const haveLocal = new Set((local.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map((r) => r.name));
  for (const col of COLUMNS) {
    if (haveLocal.has(col)) { console.log(`Local: ${col} already there`); continue; }
    local.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
    console.log(`Local: added ${col}`);
  }
  local.exec(INDEX);
  local.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
