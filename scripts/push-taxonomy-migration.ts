/**
 * push-taxonomy-migration.ts — Pushes the content taxonomy restructure to Turso.
 *
 * Pushes ONLY these two tables, in order:
 *   1. `taxonomy_categories` — full UPSERT of all 13 rows (3 renamed, 1 new,
 *      1 deactivated, 8 unchanged). Safe to UPSERT everything.
 *   2. `book_category_ratings` — all rows with `updated_at >= today` (i.e.,
 *      everything the migration touched today: SA merge, witchcraft split,
 *      occult backfill placeholders). ~67K rows.
 *
 * Nothing else is pushed. Books table, authors, series, etc. are untouched.
 *
 * Uses `INSERT OR REPLACE` keyed on the primary key id. Since local IDs came
 * from Turso via sync-pull, existing rows are matched by id; new rows
 * (occult_demonology, backfill placeholders) insert cleanly.
 *
 * Batch size: 200 statements per remote.batch() call to keep round-trips
 * manageable (libsql supports large batches as a single transaction).
 */

require("dotenv").config({ path: ".env.vercel.local" });
const { createClient } = require("@libsql/client");
const Database = require("better-sqlite3");
const path = require("path");

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("ERROR: TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing from .env.vercel.local");
  process.exit(1);
}

const remote = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const local = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });

const CHUNK = 200;

type Cat = {
  id: string;
  key: string;
  name: string;
  description: string;
  active: number;
};

type Rating = {
  id: string;
  book_id: string;
  category_id: string;
  intensity: number;
  notes: string | null;
  evidence_level: string;
  updated_by_user_id: string | null;
  updated_at: string;
};

(async () => {
  const t0 = Date.now();

  // ── Section 1: taxonomy_categories (full UPSERT) ──
  console.log("→ Pushing taxonomy_categories");
  const cats = local.prepare(`SELECT * FROM taxonomy_categories`).all() as Cat[];
  console.log(`  ${cats.length} rows`);

  const catStatements = cats.map((c) => ({
    sql: `INSERT OR REPLACE INTO taxonomy_categories (id, key, name, description, active) VALUES (?, ?, ?, ?, ?)`,
    args: [c.id, c.key, c.name, c.description, c.active],
  }));

  try {
    await remote.batch(catStatements, "write");
    console.log(`  ✓ pushed ${cats.length} categories`);
  } catch (e: any) {
    console.error(`  ✗ categories batch failed: ${e.message}`);
    process.exit(1);
  }

  // ── Section 2: book_category_ratings (touched today) ──
  console.log("\n→ Pushing book_category_ratings (touched today)");
  const rows = local
    .prepare(
      `SELECT id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at
         FROM book_category_ratings
        WHERE updated_at >= date('now')
        ORDER BY book_id`,
    )
    .all() as Rating[];
  console.log(`  ${rows.length} rows to push in batches of ${CHUNK}`);

  let pushed = 0;
  let failed = 0;
  let batchNum = 0;
  const totalBatches = Math.ceil(rows.length / CHUNK);

  for (let i = 0; i < rows.length; i += CHUNK) {
    batchNum++;
    const chunk = rows.slice(i, i + CHUNK);
    const statements = chunk.map((r) => ({
      sql: `INSERT OR REPLACE INTO book_category_ratings
              (id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id,
        r.book_id,
        r.category_id,
        r.intensity,
        r.notes,
        r.evidence_level,
        r.updated_by_user_id,
        r.updated_at,
      ],
    }));

    try {
      await remote.batch(statements, "write");
      pushed += chunk.length;
    } catch (e: any) {
      failed += chunk.length;
      console.error(`  ✗ batch ${batchNum}/${totalBatches} failed: ${e.message.slice(0, 200)}`);
    }

    if (batchNum % 20 === 0 || batchNum === totalBatches) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `  batch ${batchNum}/${totalBatches}  pushed=${pushed} failed=${failed}  elapsed=${elapsed}s`,
      );
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n────────────────────────────────────`);
  console.log(`Totals: ${pushed} rows pushed, ${failed} failed`);
  console.log(`Elapsed: ${elapsed}s`);

  if (failed > 0) {
    console.log(`\n⚠️  Some rows failed. Re-run the script to retry (UPSERT is idempotent).`);
    process.exit(1);
  }

  console.log(`\nPush complete.`);
  local.close();
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
