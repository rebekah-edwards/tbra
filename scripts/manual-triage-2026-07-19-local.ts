/**
 * Local-mirror replay for manual-triage-2026-07-19. The prod run's local writes
 * were skipped (SQLITE_BUSY — dev server + a nightly job contend on the WAL
 * writer lock). Turso already holds the correct state; this applies the same
 * mutations to data/tbra.db so sync-push won't resurrect the deleted books.
 * All writes go in ONE transaction (single lock acquisition) with retry/backoff.
 */
import { createClient } from "@libsql/client";

const DELETED = [
  "68db31b0-84bd-4168-8d65-7a6fbf39395d", // Frankenstein: The 1818 Text
  "079c071b-5dd1-499e-86eb-51061ecd8e56", "3b2daf4f-7059-4cb8-8e6c-523bc6bd59a7",
  "4107daea-2a31-433f-b3ae-1681855e9132", "552848e5-fa85-4c3f-ad59-2bb925ef725a",
  "5d86b024-2eba-40af-ac49-23e8970e638b", "62170868-81ef-458f-81ee-bfc3151e6148",
  "627ef6f7-20aa-4400-8687-4e2d61e3fd74", "915ad6a6-d288-4c60-8a29-7f4ffe674476",
  "9449040a-7125-4559-9cf6-7f1607dff554", "6097a973-63a4-4b81-b1e3-443dec21a7d7",
  "e567c973-cee0-463d-9fae-ca8a42a93dbb", // Conversations on the Power of Habit
];
const CANON_FRANK = "a6745cee-a91f-4a43-a23d-0ed2234c1ed7";
const DUPE_1818 = "68db31b0-84bd-4168-8d65-7a6fbf39395d";
const WAYFARERS = "db12d2c7-6cd2-484c-a8ea-7117151ef4ba";
const BTF = "9fd105e7-9d05-4b27-a783-e6bf52d23b57";
const GENRE_HORROR = "894d3d9d-a487-43e6-b84d-feebd1e1854f";
const GENRE_HIST_FIC = "43132973-3bf0-4823-b566-149d113dde56";
const RESOLUTIONS: [string, string][] = [
  ["d1964d18-e134-434b-a056-46541b9f0b3d", `[merged] "Frankenstein: The 1818 Text" and 10 zero-user duplicate "Frankenstein" (Mary Shelley) entries merged into canonical /book/frankenstein-mary-shelley; reader activity (2 users) moved. Translations, "Modern Prometheus" variants, adaptations, and study guides left untouched.`],
  ["278b7335-6aff-4710-9a88-cc2cbd04d706", `[deleted] "Conversation Starters" companion/summary book about Duhigg's The Power of Habit (publisher: Daily Books), 0 users — removed as book-about-a-book per report.`],
  ["4e187f23-a0ec-4892-8262-93fe79996571", `[fixed] Set is_box_set=1.`],
  ["721b5b71-eb94-4497-bd79-ab19a38c7e08", `[fixed] Reordered genres so primary is Horror (was Historical Fiction); Historical Fiction and Fantasy kept as secondary.`],
];
const FK_TABLES = [
  "book_authors", "book_genres", "book_series", "book_category_ratings",
  "book_narrators", "links", "report_corrections", "editions",
  "user_owned_editions", "enrichment_log", "user_hidden_books", "reading_notes",
  "up_next", "user_favorite_books", "user_book_reviews", "user_book_ratings",
  "reading_sessions", "user_book_state", "tbr_notes", "shelf_books", "buddy_reads",
];
const DEDUP_TABLES = ["user_book_state", "user_book_ratings", "user_book_reviews", "up_next", "user_favorite_books", "user_owned_editions", "user_hidden_books"];
const REPOINT_ONLY = ["reading_sessions", "reading_notes"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = createClient({ url: "file:./data/tbra.db" });

  // Which FK/user tables actually exist locally (a missing table aborts a batch).
  const tblRows = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
  const existing = new Set(tblRows.rows.map((r: any) => r.name));
  const fk = FK_TABLES.filter((t) => existing.has(t));
  const dedup = DEDUP_TABLES.filter((t) => existing.has(t));
  const repoint = REPOINT_ONLY.filter((t) => existing.has(t));

  // Reads needed to build the BTF reorder.
  const fantasyRow = await db.execute({ sql: `SELECT g.id FROM book_genres bg JOIN genres g ON g.id=bg.genre_id WHERE bg.book_id=? AND g.name='Fantasy'`, args: [BTF] });
  const fantasyId = (fantasyRow.rows[0] as any)?.id as string | undefined;
  const btfPresent = new Set((await db.execute({ sql: `SELECT genre_id FROM book_genres WHERE book_id=?`, args: [BTF] })).rows.map((r: any) => r.genre_id));
  const reorder = [GENRE_HORROR, GENRE_HIST_FIC, ...(fantasyId ? [fantasyId] : [])].filter((g) => btfPresent.has(g));

  const stmts: { sql: string; args: any[] }[] = [];
  // 1. Merge 1818 Text activity -> canonical
  for (const t of dedup) {
    stmts.push({ sql: `DELETE FROM ${t} WHERE book_id=? AND user_id IN (SELECT user_id FROM ${t} WHERE book_id=?)`, args: [DUPE_1818, CANON_FRANK] });
    stmts.push({ sql: `UPDATE ${t} SET book_id=? WHERE book_id=?`, args: [CANON_FRANK, DUPE_1818] });
  }
  for (const t of repoint) stmts.push({ sql: `UPDATE ${t} SET book_id=? WHERE book_id=?`, args: [CANON_FRANK, DUPE_1818] });
  // 2. Delete the 12 books (detach reports first, then FK cascade, then book)
  for (const bookId of DELETED) {
    stmts.push({ sql: `UPDATE reported_issues SET book_id=NULL, status=CASE WHEN status='new' THEN 'resolved' ELSE status END, resolved_at=CASE WHEN status='new' THEN datetime('now') ELSE resolved_at END WHERE book_id=?`, args: [bookId] });
    for (const t of fk) stmts.push({ sql: `DELETE FROM ${t} WHERE book_id = ?`, args: [bookId] });
    stmts.push({ sql: `DELETE FROM books WHERE id = ?`, args: [bookId] });
  }
  // 3. Wayfarers box set
  stmts.push({ sql: `UPDATE books SET is_box_set=1, updated_at=datetime('now') WHERE id=?`, args: [WAYFARERS] });
  // 4. BTF genre reorder (Horror first)
  for (const gid of reorder) stmts.push({ sql: `DELETE FROM book_genres WHERE book_id=? AND genre_id=?`, args: [BTF, gid] });
  for (const gid of reorder) stmts.push({ sql: `INSERT INTO book_genres (book_id, genre_id) VALUES (?, ?)`, args: [BTF, gid] });
  stmts.push({ sql: `UPDATE books SET updated_at=datetime('now') WHERE id=?`, args: [BTF] });
  // 5. Report resolutions
  for (const [id, text] of RESOLUTIONS) stmts.push({ sql: `UPDATE reported_issues SET status='resolved', resolved_at=datetime('now'), resolution=? WHERE id=?`, args: [text, id] });

  // Run the whole batch as one write transaction, retrying on SQLITE_BUSY.
  // sync-pull.ts holds the WAL writer lock for a long bulk pass; be patient.
  const MAX_ATTEMPTS = 600; // ~ up to ~25 min at 2.5s cap
  let ok = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
    try {
      await db.batch(stmts, "write");
      ok = true;
      console.log(`batch committed on attempt ${attempt} (${stmts.length} statements)`);
    } catch (e: any) {
      if (/SQLITE_BUSY|database is locked/i.test(String(e?.message ?? e))) {
        if (attempt % 20 === 0) console.log(`  busy, retry ${attempt}/${MAX_ATTEMPTS} …`);
        await sleep(Math.min(500 * attempt, 2500));
      } else {
        throw e;
      }
    }
  }
  if (!ok) throw new Error(`could not acquire writer lock after ${MAX_ATTEMPTS} attempts`);

  // Verify parity.
  const survivors = await db.execute({ sql: `SELECT id FROM books WHERE id IN (${DELETED.map(() => "?").join(",")})`, args: DELETED });
  const order = await db.execute({ sql: `SELECT g.name FROM book_genres bg JOIN genres g ON g.id=bg.genre_id WHERE bg.book_id=? AND g.name IN ('Horror','Historical Fiction') ORDER BY bg.rowid`, args: [BTF] });
  const box = await db.execute({ sql: `SELECT is_box_set FROM books WHERE id=?`, args: [WAYFARERS] });
  console.log(`survivors (should be 0): ${survivors.rows.length}`);
  console.log(`BTF direct-whitelist order: ${order.rows.map((r: any) => r.name).join(" -> ")}`);
  console.log(`Wayfarers is_box_set: ${(box.rows[0] as any)?.is_box_set}`);
  if (survivors.rows.length !== 0) throw new Error("local still has deleted books");
  console.log("LOCAL PARITY OK");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
