/**
 * replay-dedup-on-turso.ts — Replay a dedup-books.ts merge on production Turso.
 *
 * Reads a manifest JSON emitted by dedup-books.ts (reports/dedup-manifest-*.json)
 * containing {dupe_id, canonical_id, dupe_title, canonical_title} tuples, then
 * for each pair:
 *   1. MOVE user activity (state, ratings, reviews, sessions, favorites, etc.)
 *      from dupe → canonical using INSERT OR IGNORE for uniqueness-constrained tables.
 *   2. DELETE remaining dupe rows in join tables + user tables.
 *   3. DELETE the dupe books row.
 *
 * Dry-run by default. Pass --apply to mutate. Pass --manifest=<path> to pick a file.
 * Defaults to the most recent manifest file in reports/.
 */
import { createClient } from "@libsql/client";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

config({ path: path.join(process.cwd(), ".env.vercel.local") });

const APPLY = process.argv.includes("--apply");
const MANIFEST_ARG = process.argv.find((a) => a.startsWith("--manifest="))?.split("=")[1];

// Locate manifest: explicit path OR newest reports/dedup-manifest-*.json
function resolveManifest(): string {
  if (MANIFEST_ARG) return MANIFEST_ARG;
  const dir = path.join(process.cwd(), "reports");
  const files = fs.readdirSync(dir).filter((f) => /^dedup-manifest-.*\.json$/.test(f));
  if (files.length === 0) throw new Error("No manifest files found in reports/");
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

const MANIFEST_PATH = resolveManifest();
const pairs: { dupe_id: string; canonical_id: string; dupe_title: string; canonical_title: string }[] =
  JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

const MOVE_TABLES_WITH_UNIQUE = [
  "user_book_state",
  "user_book_ratings",
  "user_book_reviews",
  "user_favorite_books",
  "user_hidden_books",
  "user_owned_editions",
  "up_next",
  "tbr_notes",
  "shelf_books",
];

const MOVE_TABLES_APPEND_OK = [
  "reading_notes",
  "reading_sessions",
  "buddy_reads",
  "reported_issues",
  "report_corrections",
];

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

// Schema cache
const colsCache = new Map<string, string[] | null>();
async function getCols(table: string): Promise<string[] | null> {
  if (colsCache.has(table)) return colsCache.get(table)!;
  try {
    const r = await client.execute({ sql: `SELECT * FROM ${table} LIMIT 0`, args: [] });
    colsCache.set(table, r.columns);
    return r.columns;
  } catch {
    colsCache.set(table, null);
    return null;
  }
}

async function processPair(p: (typeof pairs)[number], idx: number, total: number) {
  const prefix = `[${idx + 1}/${total}]`;

  // Check presence on live
  const exists = await client.execute({
    sql: "SELECT 1 FROM books WHERE id = ?",
    args: [p.dupe_id],
  });
  if (exists.rows.length === 0) return { status: "skipped_not_on_live", activity: 0, deleted: 0 };

  let activityMoved = 0;
  let rowsDeleted = 0;

  // 1. MOVE user-data rows with uniqueness
  for (const t of MOVE_TABLES_WITH_UNIQUE) {
    const cols = await getCols(t);
    if (!cols || !cols.includes("book_id")) continue;
    const cnt = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`,
      args: [p.dupe_id],
    });
    const n = Number((cnt.rows[0] as any).n);
    if (n === 0) continue;
    const selectList = cols.map((c) => c === "book_id" ? `'${p.canonical_id}' AS book_id` : c).join(", ");
    const insertSql = `INSERT OR IGNORE INTO ${t} (${cols.join(", ")}) SELECT ${selectList} FROM ${t} WHERE book_id = ?`;
    const deleteSql = `DELETE FROM ${t} WHERE book_id = ?`;
    if (APPLY) {
      const r1 = await client.execute({ sql: insertSql, args: [p.dupe_id] });
      const r2 = await client.execute({ sql: deleteSql, args: [p.dupe_id] });
      activityMoved += Number(r1.rowsAffected);
      rowsDeleted += Number(r2.rowsAffected);
    } else {
      activityMoved += n;
    }
  }

  // 2. MOVE append-OK rows (plain UPDATE)
  for (const t of MOVE_TABLES_APPEND_OK) {
    const cols = await getCols(t);
    if (!cols || !cols.includes("book_id")) continue;
    const cnt = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`,
      args: [p.dupe_id],
    });
    const n = Number((cnt.rows[0] as any).n);
    if (n === 0) continue;
    if (APPLY) {
      const r = await client.execute({
        sql: `UPDATE ${t} SET book_id = ? WHERE book_id = ?`,
        args: [p.canonical_id, p.dupe_id],
      });
      activityMoved += Number(r.rowsAffected);
    } else {
      activityMoved += n;
    }
  }

  // 3. Delete join-table rows on dupe
  for (const t of JOIN_TABLES) {
    const cols = await getCols(t);
    if (!cols || !cols.includes("book_id")) continue;
    const cnt = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`,
      args: [p.dupe_id],
    });
    const n = Number((cnt.rows[0] as any).n);
    if (n === 0) continue;
    if (APPLY) {
      const r = await client.execute({
        sql: `DELETE FROM ${t} WHERE book_id = ?`,
        args: [p.dupe_id],
      });
      rowsDeleted += Number(r.rowsAffected);
    } else {
      rowsDeleted += n;
    }
  }

  // 4. Delete the dupe book
  if (APPLY) {
    const r = await client.execute({
      sql: `DELETE FROM books WHERE id = ?`,
      args: [p.dupe_id],
    });
    rowsDeleted += Number(r.rowsAffected);
  } else {
    rowsDeleted += 1;
  }

  if ((idx + 1) % 50 === 0 || idx === total - 1) {
    console.log(`${prefix} "${p.dupe_title.slice(0, 40)}" → "${p.canonical_title.slice(0, 40)}"`);
  }

  return { status: "done", activity: activityMoved, deleted: rowsDeleted };
}

async function main() {
  console.log(`=== replay-dedup-on-turso.ts ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Pairs: ${pairs.length}`);
  console.log(`Turso: ${url!.slice(0, 60)}...`);
  console.log();

  let doneOk = 0;
  let skipNotOnLive = 0;
  let totalActivity = 0;
  let totalDeleted = 0;
  const errors: { pair: any; err: string }[] = [];
  const started = Date.now();

  for (let i = 0; i < pairs.length; i++) {
    try {
      const r = await processPair(pairs[i], i, pairs.length);
      if (r.status === "skipped_not_on_live") skipNotOnLive++;
      else if (r.status === "done") {
        doneOk++;
        totalActivity += r.activity;
        totalDeleted += r.deleted;
      }
    } catch (e: any) {
      errors.push({ pair: pairs[i], err: e?.message || String(e) });
      console.warn(`[${i + 1}] ERROR on ${pairs[i].dupe_id}: ${e?.message}`);
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log();
  console.log("=== SUMMARY ===");
  console.log(`  processed:           ${doneOk}`);
  console.log(`  skipped (not on live): ${skipNotOnLive}`);
  console.log(`  errors:              ${errors.length}`);
  console.log(`  activity rows moved: ${totalActivity}`);
  console.log(`  child/book rows deleted: ${totalDeleted}`);
  console.log(`  elapsed:             ${elapsed}s`);

  if (errors.length > 0) {
    console.log("\n--- errors ---");
    for (const e of errors.slice(0, 20)) {
      console.log(`  ${e.pair.dupe_id}  ${e.pair.dupe_title.slice(0, 40)}  —  ${e.err.slice(0, 200)}`);
    }
    if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`);
  }

  if (!APPLY) console.log("\nDRY-RUN. Re-run with --apply.");
  client.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  client.close();
  process.exit(1);
});
