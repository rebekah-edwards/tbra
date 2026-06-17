/**
 * Migration: add users.google_sub (nullable) + a UNIQUE index, on BOTH local
 * SQLite and production Turso. Must run BEFORE deploying code that reads/writes
 * google_sub (per the CLAUDE.md schema-on-Turso-first rule).
 *
 * Idempotent: skips the column if it already exists; index uses IF NOT EXISTS.
 * A UNIQUE INDEX (not an inline UNIQUE constraint) is used because SQLite can't
 * ALTER-ADD a UNIQUE column — and a unique index permits many NULLs, which is
 * exactly right (only Google-linked accounts have a google_sub).
 *
 * Usage: npx tsx scripts/migrate-google-sub.ts
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import { createClient, Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

async function hasColumn(c: Client, table: string, col: string): Promise<boolean> {
  const r = await c.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function migrate(c: Client, label: string) {
  if (await hasColumn(c, "users", "google_sub")) {
    console.log(`  [${label}] google_sub already exists — skipping ADD COLUMN`);
  } else {
    await c.execute(`ALTER TABLE users ADD COLUMN google_sub text`);
    console.log(`  [${label}] ✓ added users.google_sub`);
  }
  await c.execute(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users(google_sub)`);
  console.log(`  [${label}] ✓ unique index ensured`);
}

(async () => {
  console.log("LOCAL:");
  const local = createClient({ url: "file:data/tbra.db" });
  await migrate(local, "local");

  console.log("TURSO:");
  const { remote } = await createGuardedTurso({ name: "migrate-google-sub", maxRuntimeMs: 5 * 60 * 1000, queryTimeoutMs: 30_000 });
  await migrate(remote, "turso");

  console.log("\n✓ Migration complete (local + Turso).");
  process.exit(0);
})();
