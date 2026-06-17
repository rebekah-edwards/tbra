/**
 * One-shot merge for "Wrack and Ruin" series duplicates.
 *
 * Three pairs — canonical <— dupe:
 *   Book 1: 0bf46070 (Rust-Colored Rain)       <— c5490042
 *   Book 2: 87c07b65 (A Safe Place to Die)      <— 3e7adb0e
 *   Book 3: 952b9823 (Unsicker Road)            <— 4971b51f
 *
 * Also:
 *   - Fix 0bf46070 slug "rustcolored-rain-otto-schafer" → "rust-colored-rain-otto-schafer"
 *   - Promote 87c07b65 + 952b9823 from import_only → public.
 *
 * Dry-run by default. Pass --apply to mutate.
 */
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const APPLY = process.argv.includes("--apply");

const PAIRS: { canonical: string; dupe: string; label: string }[] = [
  { canonical: "0bf46070-401d-4f92-9d4c-f47ee1a2a80a", dupe: "c5490042-3561-4967-82a7-b4eefd5252c1", label: "Rust-Colored Rain (Book 1)" },
  { canonical: "87c07b65-936c-2321-b9c7-97d7aaa2b0f1", dupe: "3e7adb0e-cddc-46da-a368-6325ca82a79b", label: "A Safe Place to Die (Book 2)" },
  { canonical: "952b9823-ccf6-caa8-5b61-e2d728cd1cc8", dupe: "4971b51f-c726-453f-a2d7-f61079c2bc69", label: "Unsicker Road (Book 3)" },
];

const PROMOTE_TO_PUBLIC = [
  "87c07b65-936c-2321-b9c7-97d7aaa2b0f1",
  "952b9823-ccf6-caa8-5b61-e2d728cd1cc8",
];

// User-data tables that reference book_id and need row migration.
// Tables with (user_id, book_id) PK or UNIQUE: use ON CONFLICT DO NOTHING
// (keep canonical's row if both sides have same user).
const USER_TABLES_WITH_UNIQUE: Array<{ table: string; unique_cols: string[] }> = [
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

// Tables that just reference book_id with no uniqueness — straight UPDATE
const USER_TABLES_APPEND_OK = [
  "reading_notes",
  "reading_sessions",
  "buddy_reads",
  "reported_issues",
  "report_corrections",
];

// Join tables that need dupe-row-removal (canonical's rows win)
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

// ─── Main ───

const db = new Database(DB_PATH);
db.pragma("foreign_keys = OFF"); // allow us to delete rows without cascade surprises
db.pragma("journal_mode = WAL");

console.log(`=== merge-wrack-ruin-dupes.ts ===`);
console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

// Pre-check: make sure all IDs exist
for (const p of PAIRS) {
  const c = db.prepare("SELECT id, title FROM books WHERE id=?").get(p.canonical);
  const d = db.prepare("SELECT id, title FROM books WHERE id=?").get(p.dupe);
  if (!c) throw new Error(`canonical missing: ${p.canonical}`);
  if (!d) throw new Error(`dupe missing: ${p.dupe}`);
  console.log(`✓ ${p.label}`);
  console.log(`    canonical: ${p.canonical} — "${(c as any).title}"`);
  console.log(`    dupe:      ${p.dupe} — "${(d as any).title}"`);
}
console.log();

function runMerge(canonical: string, dupe: string, label: string) {
  console.log(`── MERGE: ${label} ──`);

  // 1. Move user-data rows with uniqueness (INSERT OR IGNORE into canonical slot)
  for (const t of USER_TABLES_WITH_UNIQUE) {
    const colsQ = db.prepare(`PRAGMA table_info(${t.table})`).all() as any[];
    if (colsQ.length === 0) {
      console.log(`    ${t.table}: (no such table, skip)`);
      continue;
    }
    const allCols = colsQ.map((c: any) => c.name);
    if (!allCols.includes("book_id")) {
      console.log(`    ${t.table}: (no book_id col, skip)`);
      continue;
    }

    // Count dupe rows
    const dupeCount = (db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE book_id = ?`).get(dupe) as any).n;
    if (dupeCount === 0) {
      console.log(`    ${t.table}: no dupe rows`);
      continue;
    }

    // Build select list with book_id substituted for canonical
    const selectList = allCols.map((c) => c === "book_id" ? `'${canonical}' AS book_id` : c).join(", ");
    const insertSql = `INSERT OR IGNORE INTO ${t.table} (${allCols.join(", ")}) SELECT ${selectList} FROM ${t.table} WHERE book_id = ?`;
    const deleteSql = `DELETE FROM ${t.table} WHERE book_id = ?`;

    if (APPLY) {
      const r1 = db.prepare(insertSql).run(dupe);
      const r2 = db.prepare(deleteSql).run(dupe);
      console.log(`    ${t.table}: moved ${r1.changes}, deleted ${r2.changes} (dupe had ${dupeCount})`);
    } else {
      console.log(`    ${t.table}: would move/drop ${dupeCount} rows`);
    }
  }

  // 2. Move append-OK rows (just UPDATE book_id)
  for (const t of USER_TABLES_APPEND_OK) {
    const colsQ = db.prepare(`PRAGMA table_info(${t})`).all() as any[];
    if (colsQ.length === 0 || !colsQ.some((c: any) => c.name === "book_id")) {
      console.log(`    ${t}: (no table or no book_id, skip)`);
      continue;
    }
    const dupeCount = (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`).get(dupe) as any).n;
    if (dupeCount === 0) {
      console.log(`    ${t}: no dupe rows`);
      continue;
    }
    if (APPLY) {
      const r = db.prepare(`UPDATE ${t} SET book_id = ? WHERE book_id = ?`).run(canonical, dupe);
      console.log(`    ${t}: updated ${r.changes}`);
    } else {
      console.log(`    ${t}: would update ${dupeCount} rows`);
    }
  }

  // 3. Junction tables — delete dupe's rows (canonical already has its own)
  for (const t of JOIN_TABLES) {
    const colsQ = db.prepare(`PRAGMA table_info(${t})`).all() as any[];
    if (colsQ.length === 0 || !colsQ.some((c: any) => c.name === "book_id")) {
      console.log(`    ${t}: (no table or no book_id, skip)`);
      continue;
    }
    const dupeCount = (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE book_id = ?`).get(dupe) as any).n;
    if (dupeCount === 0) continue;
    if (APPLY) {
      const r = db.prepare(`DELETE FROM ${t} WHERE book_id = ?`).run(dupe);
      console.log(`    ${t}: deleted ${r.changes} dupe rows`);
    } else {
      console.log(`    ${t}: would delete ${dupeCount} dupe rows`);
    }
  }

  // 4. Delete the dupe book itself
  if (APPLY) {
    const r = db.prepare(`DELETE FROM books WHERE id = ?`).run(dupe);
    console.log(`    books: deleted ${r.changes} dupe book row`);
  } else {
    console.log(`    books: would delete dupe book`);
  }

  console.log();
}

const txn = db.transaction(() => {
  for (const p of PAIRS) runMerge(p.canonical, p.dupe, p.label);

  // 5. Promote visibility for specific canonicals
  for (const id of PROMOTE_TO_PUBLIC) {
    if (APPLY) {
      const r = db.prepare(
        `UPDATE books SET visibility='public', updated_at=datetime('now') WHERE id=? AND visibility!='public'`,
      ).run(id);
      console.log(`promote ${id}: rowsChanged=${r.changes}`);
    } else {
      const row = db.prepare(`SELECT visibility FROM books WHERE id=?`).get(id) as any;
      console.log(`promote ${id}: current visibility=${row?.visibility} → 'public'`);
    }
  }

  // 6. Fix RCR canonical slug
  const RCR_ID = "0bf46070-401d-4f92-9d4c-f47ee1a2a80a";
  const current = db.prepare(`SELECT slug FROM books WHERE id=?`).get(RCR_ID) as any;
  const NEW_SLUG = "rust-colored-rain-otto-schafer";
  if (current?.slug !== NEW_SLUG) {
    if (APPLY) {
      const r = db.prepare(`UPDATE books SET slug=?, updated_at=datetime('now') WHERE id=?`).run(NEW_SLUG, RCR_ID);
      console.log(`slug fix ${RCR_ID}: ${current?.slug} → ${NEW_SLUG}  (rowsChanged=${r.changes})`);
    } else {
      console.log(`slug fix ${RCR_ID}: ${current?.slug} → ${NEW_SLUG}  (would apply)`);
    }
  } else {
    console.log(`slug fix ${RCR_ID}: already ${NEW_SLUG}`);
  }
});

txn();

// Post-check
console.log("\n=== POST-STATE ===");
const rows = db
  .prepare(
    `SELECT b.id, b.slug, b.title, b.visibility, b.cover_source, s.name AS series, bs.position_in_series AS pos
     FROM books b
     LEFT JOIN book_series bs ON bs.book_id = b.id
     LEFT JOIN series s ON s.id = bs.series_id
     WHERE s.name IN ('Wrack and Ruin', 'God Stones')
        OR b.id IN (${PAIRS.map((p) => `'${p.canonical}'`).join(", ")}, ${PAIRS.map((p) => `'${p.dupe}'`).join(", ")})
     ORDER BY s.name, bs.position_in_series, b.title`,
  )
  .all();
console.table(rows);

if (!APPLY) {
  console.log("\nDRY-RUN complete. Re-run with --apply to mutate.");
}

db.close();
