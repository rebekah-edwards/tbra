/**
 * fix-parade-dupe.ts — Merge A Parade of Horribles duplicate into canonical, on local + Turso.
 *
 * Canonical: a2c6ceba-d702-4ea4-bf02-5369b96d4b78 (slug: a-parade-of-horribles-matt-dinniman)
 * Dupe:      bd8400ed-2580-4762-be68-059bb5992606 (slug: a-parade-of-horribles)
 *
 * The dupe has 0 user activity (confirmed) so we simply:
 *   1. Move any book_series rows to canonical (INSERT OR IGNORE) then delete from dupe
 *   2. Delete all remaining FK rows for dupe
 *   3. Delete dupe book row
 *
 * Also resolves the outstanding user report that explicitly asked for the merge.
 * Runs on both Turso (production) and local SQLite.
 *
 * Pass --apply to mutate. Default is dry-run.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient, type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

const APPLY = process.argv.includes("--apply");

const CANONICAL_ID = "a2c6ceba-d702-4ea4-bf02-5369b96d4b78";
const DUPE_ID = "bd8400ed-2580-4762-be68-059bb5992606";
const REPORT_ID = "11707ae6-77d7-438f-94de-bc84a22e9f98";

const FK_TABLES = [
  "book_series",
  "book_authors",
  "book_genres",
  "book_category_ratings",
  "book_narrators",
  "links",
  "report_corrections",
  "editions",
  "user_owned_editions",
  "enrichment_log",
  "reported_issues",
  "user_hidden_books",
  "reading_notes",
  "up_next",
  "user_favorite_books",
  "user_book_reviews",
  "user_book_ratings",
  "reading_sessions",
  "user_book_state",
  "tbr_notes",
  "shelf_books",
  "buddy_reads",
];

async function tursoFix(client: Client) {
  console.log("\n=== TURSO ===");

  // move book_series: keep canonical's rows; add any dupe-only rows
  const dupeSeries = await client.execute({
    sql: "SELECT series_id, position_in_series FROM book_series WHERE book_id = ?",
    args: [DUPE_ID],
  });
  console.log(`  dupe book_series rows: ${dupeSeries.rows.length}`);
  for (const row of dupeSeries.rows) {
    const seriesId = row.series_id as string;
    const pos = row.position_in_series;
    const existing = await client.execute({
      sql: "SELECT 1 FROM book_series WHERE book_id = ? AND series_id = ?",
      args: [CANONICAL_ID, seriesId],
    });
    if (existing.rows.length === 0) {
      console.log(`  -> moving series ${seriesId} (pos ${pos}) to canonical`);
      if (APPLY) {
        await client.execute({
          sql: "INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)",
          args: [CANONICAL_ID, seriesId, pos],
        });
      }
    } else {
      console.log(`  -> canonical already linked to series ${seriesId}, skipping`);
    }
  }

  // delete FK rows for dupe
  for (const table of FK_TABLES) {
    try {
      if (APPLY) {
        const r = await client.execute({
          sql: `DELETE FROM ${table} WHERE book_id = ?`,
          args: [DUPE_ID],
        });
        if (r.rowsAffected > 0) console.log(`  deleted ${r.rowsAffected} from ${table}`);
      } else {
        const r = await client.execute({
          sql: `SELECT COUNT(*) c FROM ${table} WHERE book_id = ?`,
          args: [DUPE_ID],
        });
        const c = Number(r.rows[0].c);
        if (c > 0) console.log(`  would delete ${c} from ${table}`);
      }
    } catch (e: any) {
      console.log(`  ${table}: ${e.message}`);
    }
  }

  // delete the book row
  if (APPLY) {
    const r = await client.execute({
      sql: "DELETE FROM books WHERE id = ?",
      args: [DUPE_ID],
    });
    console.log(`  deleted books row: rowsAffected=${r.rowsAffected}`);
  } else {
    console.log("  would delete books row");
  }

  // resolve the user's outstanding merge report
  if (APPLY) {
    const r = await client.execute({
      sql: `UPDATE reported_issues SET status='resolved', resolved_at=datetime('now'), resolution=? WHERE id=?`,
      args: [
        "Merged duplicate book bd8400ed (slug: a-parade-of-horribles) into canonical a2c6ceba (slug: a-parade-of-horribles-matt-dinniman). Dupe had 0 user activity.",
        REPORT_ID,
      ],
    });
    console.log(`  resolved report ${REPORT_ID}: rowsAffected=${r.rowsAffected}`);
  } else {
    console.log(`  would update report ${REPORT_ID} resolution`);
  }
}

function localFix() {
  console.log("\n=== LOCAL ===");
  const dbPath = path.join(process.cwd(), "data", "tbra.db");
  const db = new Database(dbPath);

  // Move book_series
  const dupeSeries = db
    .prepare("SELECT series_id, position_in_series FROM book_series WHERE book_id = ?")
    .all(DUPE_ID) as { series_id: string; position_in_series: any }[];
  console.log(`  dupe book_series rows: ${dupeSeries.length}`);
  for (const r of dupeSeries) {
    const exists = db
      .prepare("SELECT 1 FROM book_series WHERE book_id = ? AND series_id = ?")
      .get(CANONICAL_ID, r.series_id);
    if (!exists) {
      console.log(`  -> moving series ${r.series_id} (pos ${r.position_in_series}) to canonical`);
      if (APPLY) {
        db.prepare(
          "INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)",
        ).run(CANONICAL_ID, r.series_id, r.position_in_series);
      }
    } else {
      console.log(`  -> canonical already linked to series ${r.series_id}, skipping`);
    }
  }

  for (const table of FK_TABLES) {
    try {
      if (APPLY) {
        const r = db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(DUPE_ID);
        if (r.changes > 0) console.log(`  deleted ${r.changes} from ${table}`);
      } else {
        const r = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE book_id = ?`).get(DUPE_ID) as { c: number };
        if (r.c > 0) console.log(`  would delete ${r.c} from ${table}`);
      }
    } catch (e: any) {
      console.log(`  ${table}: ${e.message}`);
    }
  }

  if (APPLY) {
    const r = db.prepare("DELETE FROM books WHERE id = ?").run(DUPE_ID);
    console.log(`  deleted books row: changes=${r.changes}`);
  } else {
    console.log("  would delete books row");
  }

  db.close();
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL!;
  const authToken = process.env.TURSO_AUTH_TOKEN!;
  const client = createClient({ url, authToken });

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`Canonical: ${CANONICAL_ID} (slug: a-parade-of-horribles-matt-dinniman)`);
  console.log(`Dupe:      ${DUPE_ID} (slug: a-parade-of-horribles)`);

  await tursoFix(client);
  localFix();

  console.log("\nDone.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
