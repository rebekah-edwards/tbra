/**
 * Delete zero-user null-slug books from LOCAL ONLY. For cases where local drifted
 * past Turso (e.g. after nightly-discovery added new null-slug books).
 */
import Database from "better-sqlite3";
import path from "path";

const APPLY = process.argv.includes("--apply");

const FK_TABLES = [
  "book_authors", "book_genres", "book_series", "book_category_ratings",
  "book_narrators", "links", "report_corrections", "editions",
  "user_owned_editions", "enrichment_log", "reported_issues",
  "user_hidden_books", "reading_notes", "up_next", "user_favorite_books",
  "user_book_reviews", "user_book_ratings", "reading_sessions",
  "user_book_state", "tbr_notes", "shelf_books", "buddy_reads",
];

const db = new Database(path.join(process.cwd(), "data", "tbra.db"));

const rows = db
  .prepare(
    `SELECT b.id, b.title,
      (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) as users
     FROM books b
     WHERE b.visibility='public' AND (b.slug IS NULL OR b.slug='' OR b.slug='null')`,
  )
  .all() as { id: string; title: string; users: number }[];

const zeroUser = rows.filter((r) => Number(r.users) === 0);
const withUsers = rows.filter((r) => Number(r.users) > 0);

console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
console.log(`Total null-slug public books (local): ${rows.length}`);
console.log(`  zero-user (will delete): ${zeroUser.length}`);
console.log(`  with users:              ${withUsers.length}`);
for (const r of withUsers) console.log(`    WITH USERS: ${r.id} — "${String(r.title).slice(0, 60)}" (${r.users})`);

if (!APPLY) { process.exit(0); }

let done = 0;
for (const r of zeroUser) {
  for (const t of FK_TABLES) {
    try { db.prepare(`DELETE FROM ${t} WHERE book_id = ?`).run(r.id); }
    catch (e: any) { if (!/no such table/i.test(String(e?.message))) throw e; }
  }
  db.prepare(`DELETE FROM books WHERE id = ?`).run(r.id);
  done++;
  if (done % 50 === 0) console.log(`  ${done}/${zeroUser.length}`);
}
console.log(`Deleted ${done}/${zeroUser.length} from local`);
db.close();
