/**
 * cleanup-null-slugs.ts — Delete zero-user null-slug books from BOTH local SQLite and Turso.
 *
 * Safety: operates per-book inside a try/catch. Post-action verify on Turso after each delete.
 * Identifies (but does NOT touch) null-slug books that have user_book_state rows — those are
 * printed at the end for manual handling.
 *
 * Pass --apply to mutate. Default is dry-run.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";
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

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  // Find all null-slug books on Turso
  const tursoRes = await client.execute({
    sql: `SELECT b.id, b.title,
            (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) as users
          FROM books b
          WHERE b.visibility = 'public' AND (b.slug IS NULL OR b.slug = '' OR b.slug = 'null')`,
    args: [],
  });
  const rows = tursoRes.rows as unknown as { id: string; title: string; users: number }[];
  console.log(`Turso null-slug public books: ${rows.length}`);

  const withUsers = rows.filter((r) => Number(r.users) > 0);
  const zeroUser = rows.filter((r) => Number(r.users) === 0);
  console.log(`  zero-user (will delete):    ${zeroUser.length}`);
  console.log(`  with users (manual review): ${withUsers.length}`);

  if (withUsers.length > 0) {
    console.log(`\n=== Null-slug books WITH user activity (manual fix required) ===`);
    for (const r of withUsers) {
      console.log(`  ${r.id} — "${String(r.title).slice(0, 70)}" — ${r.users} user(s)`);
    }
  }

  if (!APPLY) {
    console.log(`\n(dry-run) Would delete ${zeroUser.length} books from local + Turso`);
    process.exit(0);
  }

  // Apply: loop through zero-user books, delete from BOTH local and Turso per book
  let done = 0;
  let failed = 0;
  const t0 = Date.now();
  for (const r of zeroUser) {
    const id = r.id;
    try {
      // LOCAL delete (better-sqlite3 is synchronous)
      for (const table of FK_TABLES) {
        try {
          db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(id);
        } catch (e: any) {
          if (!/no such table/i.test(String(e?.message ?? e))) throw e;
        }
      }
      db.prepare(`DELETE FROM books WHERE id = ?`).run(id);

      // TURSO delete
      for (const table of FK_TABLES) {
        try {
          await client.execute({ sql: `DELETE FROM ${table} WHERE book_id = ?`, args: [id] });
        } catch (e: any) {
          if (!/no such table/i.test(String(e?.message ?? e))) throw e;
        }
      }
      await client.execute({ sql: `DELETE FROM books WHERE id = ?`, args: [id] });

      // Verify on Turso
      const v = await client.execute({ sql: `SELECT 1 FROM books WHERE id = ?`, args: [id] });
      if (v.rows.length !== 0) throw new Error("verify failed: book still present on Turso");

      done++;
      if (done % 50 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        const eta = Math.round((zeroUser.length - done) / rate);
        console.log(`  ${done}/${zeroUser.length}  (${rate.toFixed(1)}/s, ETA ${eta}s)`);
      }
    } catch (e: any) {
      failed++;
      console.error(`  FAILED ${id} "${String(r.title).slice(0, 50)}": ${e.message}`);
    }
  }
  db.close();

  const dur = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== DONE ===`);
  console.log(`Deleted: ${done}/${zeroUser.length} in ${dur}s`);
  console.log(`Failed:  ${failed}`);
  console.log(`With-users books still need manual fix: ${withUsers.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
