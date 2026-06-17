/**
 * One-shot: merge-and-delete the three Wrack and Ruin dupe book IDs on production Turso.
 *
 * For each pair:
 *   1. MOVE user activity (state, ratings, reviews, sessions, favorites, etc.) from
 *      dupe → canonical. INSERT OR IGNORE for tables with (user_id, book_id) UNIQUE.
 *   2. DELETE remaining dupe rows from all child tables (join tables + any unmoved rows).
 *   3. DELETE the dupe books row.
 *
 * Critical because Turso may hold user activity on the dupes that hasn't been sync-pulled
 * locally (e.g. recent PWA edits). A naive DELETE would lose that activity.
 *
 * Dry-run by default. Pass --apply to mutate.
 */
import { createClient } from "@libsql/client";
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.vercel.local") });

const APPLY = process.argv.includes("--apply");

// canonical <— dupe
const PAIRS: { canonical: string; dupe: string; label: string }[] = [
  { canonical: "0bf46070-401d-4f92-9d4c-f47ee1a2a80a", dupe: "c5490042-3561-4967-82a7-b4eefd5252c1", label: "Rust-Colored Rain (Book 1)" },
  { canonical: "87c07b65-936c-2321-b9c7-97d7aaa2b0f1", dupe: "3e7adb0e-cddc-46da-a368-6325ca82a79b", label: "A Safe Place to Die (Book 2)" },
  { canonical: "952b9823-ccf6-caa8-5b61-e2d728cd1cc8", dupe: "4971b51f-c726-453f-a2d7-f61079c2bc69", label: "Unsicker Road (Book 3)" },
];

// User-data tables where we want to MOVE rows (not just delete them).
// For tables with (user_id, book_id) UNIQUE, we INSERT OR IGNORE: if canonical already has
// a row for that user, the dupe row gets silently dropped (user's existing canonical row wins).
const MOVE_TABLES_WITH_UNIQUE: { table: string; unique_cols: string[] }[] = [
  { table: "user_book_state",      unique_cols: ["user_id", "book_id"] },
  { table: "user_book_ratings",    unique_cols: ["user_id", "book_id"] },
  { table: "user_book_reviews",    unique_cols: ["user_id", "book_id"] },
  { table: "user_favorite_books",  unique_cols: ["user_id", "book_id"] },
  { table: "user_hidden_books",    unique_cols: ["user_id", "book_id"] },
  { table: "user_owned_editions",  unique_cols: ["user_id", "book_id"] },
  { table: "up_next",              unique_cols: ["user_id", "book_id"] },
  { table: "tbr_notes",            unique_cols: ["user_id", "book_id"] },
  { table: "shelf_books",          unique_cols: ["shelf_id", "book_id"] },
];

// No-uniqueness user-data tables: straight UPDATE book_id dupe → canonical
const MOVE_TABLES_APPEND_OK = [
  "reading_notes",
  "reading_sessions",
  "buddy_reads",
  "reported_issues",
  "report_corrections",
];

// Join tables — delete dupe's rows (canonical already has its own)
const JOIN_TABLES = [
  "book_authors",
  "book_genres",
  "book_series",
  "book_category_ratings",
  "book_narrators",
  "editions",
  "enrichment_log",
  "links",
];

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in .env.vercel.local");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  console.log(`=== delete-dupes-on-turso.ts ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Turso: ${url.slice(0, 60)}...`);
  console.log();

  // Fetch column lists once per table (assumes schemas match between live and local)
  const colsCache = new Map<string, string[]>();
  async function getCols(table: string): Promise<string[] | null> {
    if (colsCache.has(table)) return colsCache.get(table)!;
    try {
      const r = await client.execute({ sql: `SELECT * FROM ${table} LIMIT 0`, args: [] });
      const cols = r.columns;
      colsCache.set(table, cols);
      return cols;
    } catch {
      return null;
    }
  }

  for (const { canonical, dupe, label } of PAIRS) {
    console.log(`── ${label}`);
    console.log(`    canonical: ${canonical}`);
    console.log(`    dupe:      ${dupe}`);

    // Confirm presence on live
    const exists = await client.execute({
      sql: "SELECT title, visibility FROM books WHERE id = ?",
      args: [dupe],
    });
    if (exists.rows.length === 0) {
      console.log(`    (dupe not on live — skip)`);
      console.log();
      continue;
    }
    const row = exists.rows[0] as any;
    console.log(`    dupe title: "${row.title}"   visibility: ${row.visibility}`);

    // 1. MOVE user-data with uniqueness — INSERT OR IGNORE then DELETE remainder
    for (const t of MOVE_TABLES_WITH_UNIQUE) {
      const cols = await getCols(t.table);
      if (!cols) { continue; }
      if (!cols.includes("book_id")) continue;
      const cnt = await client.execute({
        sql: `SELECT COUNT(*) AS n FROM ${t.table} WHERE book_id = ?`,
        args: [dupe],
      });
      const n = Number((cnt.rows[0] as any).n);
      if (n === 0) continue;

      const selectList = cols.map((c) => c === "book_id" ? `'${canonical}' AS book_id` : c).join(", ");
      const insertSql = `INSERT OR IGNORE INTO ${t.table} (${cols.join(", ")}) SELECT ${selectList} FROM ${t.table} WHERE book_id = ?`;
      const deleteSql = `DELETE FROM ${t.table} WHERE book_id = ?`;

      if (APPLY) {
        const r1 = await client.execute({ sql: insertSql, args: [dupe] });
        const r2 = await client.execute({ sql: deleteSql, args: [dupe] });
        console.log(`    ${t.table}: moved ${r1.rowsAffected}, deleted ${r2.rowsAffected} (dupe had ${n})`);
      } else {
        console.log(`    ${t.table}: would MOVE/DROP ${n} rows`);
      }
    }

    // 2. MOVE append-OK rows (plain UPDATE)
    for (const t of MOVE_TABLES_APPEND_OK) {
      const cols = await getCols(t);
      if (!cols || !cols.includes("book_id")) continue;
      const cnt = await client.execute({
        sql: `SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`,
        args: [dupe],
      });
      const n = Number((cnt.rows[0] as any).n);
      if (n === 0) continue;
      if (APPLY) {
        const r = await client.execute({
          sql: `UPDATE ${t} SET book_id = ? WHERE book_id = ?`,
          args: [canonical, dupe],
        });
        console.log(`    ${t}: updated ${r.rowsAffected}`);
      } else {
        console.log(`    ${t}: would UPDATE ${n} rows`);
      }
    }

    // 3. Delete dupe rows in join tables
    for (const t of JOIN_TABLES) {
      const cols = await getCols(t);
      if (!cols || !cols.includes("book_id")) continue;
      const cnt = await client.execute({
        sql: `SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`,
        args: [dupe],
      });
      const n = Number((cnt.rows[0] as any).n);
      if (n === 0) continue;
      if (APPLY) {
        const r = await client.execute({
          sql: `DELETE FROM ${t} WHERE book_id = ?`,
          args: [dupe],
        });
        console.log(`    ${t}: deleted ${r.rowsAffected} rows`);
      } else {
        console.log(`    ${t}: would delete ${n} rows`);
      }
    }

    // 4. Delete the dupe book itself
    if (APPLY) {
      const r = await client.execute({
        sql: `DELETE FROM books WHERE id = ?`,
        args: [dupe],
      });
      console.log(`    books: deleted ${r.rowsAffected} row`);
    } else {
      console.log(`    books: would delete 1 row`);
    }
    console.log();
  }

  // 5. Push canonical field updates that sync-push.ts step 5b doesn't cover
  //    (visibility, slug — both explicitly excluded from the metadata push list).
  const CANONICAL_UPDATES: { id: string; visibility?: string; slug?: string }[] = [
    { id: "87c07b65-936c-2321-b9c7-97d7aaa2b0f1", visibility: "public" },                       // A Safe Place to Die
    { id: "952b9823-ccf6-caa8-5b61-e2d728cd1cc8", visibility: "public" },                       // Unsicker Road
    { id: "0bf46070-401d-4f92-9d4c-f47ee1a2a80a", slug: "rust-colored-rain-otto-schafer" },     // RCR slug fix
  ];

  console.log("── Canonical field updates (bypass sync-push which excludes slug/visibility):");
  for (const u of CANONICAL_UPDATES) {
    const sets: string[] = [];
    const args: any[] = [];
    if (u.visibility) { sets.push("visibility = ?"); args.push(u.visibility); }
    if (u.slug) { sets.push("slug = ?"); args.push(u.slug); }
    sets.push("updated_at = datetime('now')");
    args.push(u.id);

    if (APPLY) {
      const r = await client.execute({
        sql: `UPDATE books SET ${sets.join(", ")} WHERE id = ?`,
        args,
      });
      console.log(`    ${u.id}: ${Object.entries(u).filter(([k]) => k !== 'id').map(([k,v]) => `${k}=${v}`).join(', ')} — rowsAffected=${r.rowsAffected}`);
    } else {
      console.log(`    ${u.id}: would SET ${Object.entries(u).filter(([k]) => k !== 'id').map(([k,v]) => `${k}=${v}`).join(', ')}`);
    }
  }

  if (!APPLY) console.log("DRY-RUN complete. Re-run with --apply.");
  client.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  client.close();
  process.exit(1);
});
