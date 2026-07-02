/**
 * One-off: repair the Cormoran Strike series (Robert Galbraith / J.K. Rowling).
 * User-requested 2026-07-02; also covers the "/series/cormoran-strike —
 * several issues" report from nightly triage.
 *
 * Fixes, dual-written to Turso + local:
 *  1. Merge the duplicate Career of Evil (keep the Robert Galbraith copy —
 *     correct 2015 year + Little Brown ISBN; the J.K. Rowling copy carries
 *     junk metadata: year 2013, print-on-demand ISBN).
 *  2. Unhide Lethal White (pos 4) and clear its needs_review flag.
 *  3. Link The Ink Black Heart into the series at position 6.
 *  4. Create The Hallmarked Man (book 8, 2025-09-02, ISBNdb metadata).
 *  5. Normalize authorship: every series book is credited to Robert
 *     Galbraith (the publication pen name); J.K. Rowling links removed
 *     from these books only.
 *
 * Idempotent: INSERT OR IGNORE / conditional UPDATEs throughout.
 */
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.vercel.local" });

const SERIES_ID = "b5d16f1a-cf7a-4730-b248-8f0fe73efab1";
const GALBRAITH_ID = "e694ad00-c1d7-4bbf-8911-80aaefb84211";
const ROWLING_IDS = ["4208efaf-cfc1-4a6f-9b35-b3f3fd4a6a9c", "870cdd36-b0b9-48e9-b000-b2444f151ed4"];

const KEEP_COE = "79cb68d9-720d-419e-8aeb-378b10dda4a2"; // career-of-evil-robert-galbraith
const DEL_COE = "5c8cd363-e138-485f-8e2f-ed415a89e02e"; // career-of-evil-j-k-rowling (junk metadata)

const HALLMARKED_ID = "b7e5f0d2-4c31-4a8e-9f66-2f8f5f1c7a90";
const HALLMARKED = {
  id: HALLMARKED_ID,
  title: "The Hallmarked Man",
  slug: "the-hallmarked-man-robert-galbraith",
  description:
    "A dismembered corpse is discovered in the vault of a silver shop. The police initially believe it to be that of a convicted armed robber - but not everyone agrees with that theory. One of them is Decima Mullins, who calls on the help of private detective Cormoran Strike as she's certain the body in the silver vault was that of her boyfriend - the father of her newborn baby - who suddenly and mysteriously disappeared.",
  publication_year: 2025,
  publication_date: "2025-09-02",
  isbn_13: "9780316586009",
  pages: 912,
  publisher: "Little, Brown and Company",
  open_library_key: "/works/OL42397680W",
  cover: "https://images.isbndb.com/covers/19343093482300.jpg",
};

// position → book id (after merge; Hallmarked Man added below)
const POSITIONS: [number, string][] = [
  [1, "ed2eba7c-7337-482e-9d92-9a2ddfa7f36d"], // The Cuckoo's Calling
  [2, "237f6a81-63d3-4968-855f-c2a70d0c22da"], // The Silkworm
  [3, KEEP_COE], //                                Career of Evil
  [4, "6a03c274-72b6-4814-8612-19689520770b"], // Lethal White
  [5, "c0398296-3e61-49c1-804b-35751b5ca34f"], // Troubled Blood
  [6, "f22077e9-bb57-4afa-b3d4-f8f4c6716acf"], // The Ink Black Heart
  [7, "9a5bb210-25c0-48ee-8116-f14b8f1e1efe"], // The Running Grave
  [8, HALLMARKED_ID], //                           The Hallmarked Man
];

const REPOINT_TABLES = [
  "user_book_state", "up_next", "user_book_ratings", "user_book_reviews",
  "user_favorite_books", "reading_sessions", "reading_notes", "tbr_notes",
  "shelf_books", "user_book_dimension_ratings", "user_hidden_books",
  "user_owned_editions", "buddy_reads", "reported_issues", "editions",
  "landing_page_books",
];

type Exec = (sql: string, args?: unknown[]) => Promise<{ rowsAffected: number; rows: Record<string, unknown>[] }>;

async function repair(label: string, exec: Exec) {
  console.log(`\n===== ${label} =====`);

  // 1. Merge Career of Evil: repoint user/edition data, then delete dupe data rows
  for (const t of REPOINT_TABLES) {
    try {
      const u = await exec(`UPDATE OR IGNORE ${t} SET book_id = ? WHERE book_id = ?`, [KEEP_COE, DEL_COE]);
      const d = await exec(`DELETE FROM ${t} WHERE book_id = ?`, [DEL_COE]);
      if (u.rowsAffected || d.rowsAffected) console.log(`  ${t}: repointed ${u.rowsAffected}, residual-deleted ${d.rowsAffected}`);
    } catch { /* table has no book_id column — skip */ }
  }
  try {
    await exec(`DELETE FROM rating_citations WHERE rating_id IN (SELECT id FROM book_category_ratings WHERE book_id = ?)`, [DEL_COE]);
  } catch { /* ok */ }
  for (const t of ["book_category_ratings", "book_authors", "book_genres", "book_series", "book_narrators", "enrichment_log"]) {
    try { await exec(`DELETE FROM ${t} WHERE book_id = ?`, [DEL_COE]); } catch { /* ok */ }
  }
  await exec(`DELETE FROM books WHERE id = ?`, [DEL_COE]);
  const gone = await exec(`SELECT id FROM books WHERE id = ?`, [DEL_COE]);
  if (gone.rows.length) throw new Error(`${label}: dupe Career of Evil row survived delete`);
  console.log(`  dupe Career of Evil deleted (verified)`);

  // 2. Lethal White: unhide
  const lw = await exec(`UPDATE books SET visibility = 'public', needs_review = 0, review_reason = NULL WHERE id = ? AND visibility != 'public'`, [POSITIONS[3][1]]);
  console.log(`  Lethal White unhidden: ${lw.rowsAffected} row`);

  // 3. The Hallmarked Man: create if missing (by id, slug, or ISBN)
  const existing = await exec(`SELECT id FROM books WHERE id = ? OR slug = ? OR isbn_13 = ?`, [HALLMARKED.id, HALLMARKED.slug, HALLMARKED.isbn_13]);
  if (existing.rows.length === 0) {
    await exec(
      `INSERT INTO books (id, title, description, publication_year, publication_date, isbn_13, pages, publisher,
        open_library_key, language, is_fiction, is_box_set, slug, cover_image_url, cover_source, cover_verified,
        needs_review, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', 1, 0, ?, ?, 'isbndb', 0, 0, 'public', datetime('now'), datetime('now'))`,
      [HALLMARKED.id, HALLMARKED.title, HALLMARKED.description, HALLMARKED.publication_year, HALLMARKED.publication_date,
       HALLMARKED.isbn_13, HALLMARKED.pages, HALLMARKED.publisher, HALLMARKED.open_library_key, HALLMARKED.slug, HALLMARKED.cover],
    );
    console.log(`  The Hallmarked Man created`);
  } else {
    console.log(`  The Hallmarked Man already present as ${existing.rows[0].id} — skipping insert`);
  }

  // 4. Author normalization: Galbraith on all series books, Rowling links off them
  for (const [, bookId] of POSITIONS) {
    await exec(`INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`, [bookId, GALBRAITH_ID]);
    for (const rid of ROWLING_IDS) {
      await exec(`DELETE FROM book_authors WHERE book_id = ? AND author_id = ?`, [bookId, rid]);
    }
  }
  console.log(`  authors normalized to Robert Galbraith on all 8 books`);

  // 5. Series positions: exactly one row per book, correct position
  for (const [pos, bookId] of POSITIONS) {
    const upd = await exec(`UPDATE book_series SET position_in_series = ? WHERE book_id = ? AND series_id = ?`, [pos, bookId, SERIES_ID]);
    if (upd.rowsAffected === 0) {
      await exec(`INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`, [bookId, SERIES_ID, pos]);
    }
  }
  // Remove any stray series members not in the canonical list
  const strays = await exec(
    `DELETE FROM book_series WHERE series_id = ? AND book_id NOT IN (${POSITIONS.map(() => "?").join(",")})`,
    [SERIES_ID, ...POSITIONS.map(([, id]) => id)],
  );
  if (strays.rowsAffected) console.log(`  removed ${strays.rowsAffected} stray series member(s)`);

  // Verify
  const check = await exec(
    `SELECT bs.position_in_series AS pos, b.title, b.visibility, b.slug
     FROM book_series bs JOIN books b ON b.id = bs.book_id
     WHERE bs.series_id = ? ORDER BY bs.position_in_series`,
    [SERIES_ID],
  );
  console.log(`  final series state:`);
  for (const r of check.rows) console.log(`    ${r.pos}. ${r.title} [${r.visibility}] ${r.slug}`);
  if (check.rows.length !== 8) throw new Error(`${label}: expected 8 series rows, got ${check.rows.length}`);
}

(async () => {
  const { remote } = await createGuardedTurso({
    name: "repair-cormoran-strike",
    maxRuntimeMs: 15 * 60 * 1000,
    queryTimeoutMs: 60_000,
  });
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));
  local.pragma("journal_mode = WAL");

  await repair("TURSO (production)", async (sql, args = []) => {
    const r = await remote.execute({ sql, args: args as never[] });
    return { rowsAffected: r.rowsAffected ?? 0, rows: r.rows as unknown as Record<string, unknown>[] };
  });

  await repair("LOCAL (data/tbra.db)", async (sql, args = []) => {
    if (/^\s*SELECT/i.test(sql)) {
      return { rowsAffected: 0, rows: local.prepare(sql).all(...(args as never[])) as Record<string, unknown>[] };
    }
    const info = local.prepare(sql).run(...(args as never[]));
    return { rowsAffected: info.changes, rows: [] };
  });

  console.log("\nDone — both databases repaired.");
  local.close();
  process.exit(0);
})();
