/**
 * fix-null-slug-user-books.ts
 *
 * Two specific fixes on Turso + local:
 *
 * 1. "Till We Have Faces" — null-slug (3876e75b…) has 1 user (tbr state).
 *    Canonical sibling (2d98812a…) has valid slug `till-we-have-faces-c-s-lewis` and 0 users.
 *    → Migrate user state from null-slug entry to canonical, then delete null-slug entry.
 *
 * 2. "Miracles" by C. S. Lewis — null-slug (c7898c25…) has 1 user (tbr state).
 *    No sibling exists.
 *    → Regenerate slug to `miracles-c-s-lewis` so the book becomes reachable.
 *
 * Pass --apply to mutate. Default dry-run.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient, type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

const APPLY = process.argv.includes("--apply");

const USER_TABLES = [
  "user_book_state",
  "user_book_ratings",
  "user_book_reviews",
  "user_favorite_books",
  "user_hidden_books",
  "user_owned_editions",
  "up_next",
  "reading_notes",
  "reading_sessions",
  "report_corrections",
  "reported_issues",
];
const FK_TABLES = [
  "book_authors", "book_genres", "book_series", "book_category_ratings",
  "book_narrators", "links", "report_corrections", "editions",
  "user_owned_editions", "enrichment_log", "reported_issues",
  "user_hidden_books", "reading_notes", "up_next", "user_favorite_books",
  "user_book_reviews", "user_book_ratings", "reading_sessions",
  "user_book_state", "tbr_notes", "shelf_books", "buddy_reads",
];

async function migrateUserDataTurso(client: Client, dupeId: string, canonicalId: string) {
  for (const t of USER_TABLES) {
    try {
      await client.execute({
        sql: `DELETE FROM ${t} WHERE book_id = ? AND user_id IN (SELECT user_id FROM ${t} WHERE book_id = ?)`,
        args: [dupeId, canonicalId],
      });
      await client.execute({
        sql: `UPDATE ${t} SET book_id = ? WHERE book_id = ?`,
        args: [canonicalId, dupeId],
      });
    } catch (e: any) {
      if (!/no such table|no such column/i.test(String(e?.message ?? e))) throw e;
    }
  }
}

function migrateUserDataLocal(db: Database.Database, dupeId: string, canonicalId: string) {
  for (const t of USER_TABLES) {
    try {
      db.prepare(
        `DELETE FROM ${t} WHERE book_id = ? AND user_id IN (SELECT user_id FROM ${t} WHERE book_id = ?)`,
      ).run(dupeId, canonicalId);
      db.prepare(`UPDATE ${t} SET book_id = ? WHERE book_id = ?`).run(canonicalId, dupeId);
    } catch (e: any) {
      if (!/no such table|no such column/i.test(String(e?.message ?? e))) throw e;
    }
  }
}

async function deleteBookTurso(client: Client, bookId: string) {
  for (const table of FK_TABLES) {
    try {
      await client.execute({ sql: `DELETE FROM ${table} WHERE book_id = ?`, args: [bookId] });
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message ?? e))) throw e;
    }
  }
  await client.execute({ sql: `DELETE FROM books WHERE id = ?`, args: [bookId] });
  const v = await client.execute({ sql: `SELECT 1 FROM books WHERE id = ?`, args: [bookId] });
  if (v.rows.length !== 0) throw new Error(`Turso delete verify failed: ${bookId}`);
}

function deleteBookLocal(db: Database.Database, bookId: string) {
  for (const table of FK_TABLES) {
    try {
      db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(bookId);
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message ?? e))) throw e;
    }
  }
  db.prepare(`DELETE FROM books WHERE id = ?`).run(bookId);
}

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  // === Fix 1: Till We Have Faces ===
  const TILL_DUPE = "3876e75b-f884-4792-ab98-4897303b134e";
  const TILL_CANONICAL = "2d98812a-e2da-4e33-82aa-e034b5f1d6cc";
  console.log(`\n[Fix 1] Till We Have Faces: merge ${TILL_DUPE} → ${TILL_CANONICAL}`);
  if (APPLY) {
    await migrateUserDataTurso(client, TILL_DUPE, TILL_CANONICAL);
    migrateUserDataLocal(db, TILL_DUPE, TILL_CANONICAL);
    await deleteBookTurso(client, TILL_DUPE);
    deleteBookLocal(db, TILL_DUPE);
    // Verify user state made it to canonical
    const v = await client.execute({
      sql: `SELECT user_id, state FROM user_book_state WHERE book_id = ?`,
      args: [TILL_CANONICAL],
    });
    console.log(`  Users on canonical now: ${v.rows.length} (expect 1)`);
    console.log(`  ✓ merged + deleted`);
  } else {
    console.log(`  (dry-run) would migrate user state to canonical, then delete null-slug entry`);
  }

  // === Fix 2: Miracles — regenerate slug on the unique book ===
  const MIRACLES_ID = "c7898c25-5a9d-402a-bd78-61f1e413ac1e";
  const NEW_SLUG = "miracles-c-s-lewis";
  console.log(`\n[Fix 2] Miracles: regenerate slug → ${NEW_SLUG}`);
  // Verify no collision
  const coll = await client.execute({
    sql: `SELECT id FROM books WHERE slug = ?`,
    args: [NEW_SLUG],
  });
  if (coll.rows.length > 0 && (coll.rows[0].id as string) !== MIRACLES_ID) {
    console.log(`  COLLISION on slug "${NEW_SLUG}" — existing book ${coll.rows[0].id}. Falling back to suffix.`);
    let suffix = 2;
    let tryS = `${NEW_SLUG}-${suffix}`;
    while (true) {
      const r = await client.execute({ sql: `SELECT id FROM books WHERE slug = ?`, args: [tryS] });
      if (r.rows.length === 0) break;
      suffix++;
      tryS = `${NEW_SLUG}-${suffix}`;
    }
    console.log(`  using "${tryS}" instead`);
    if (APPLY) {
      await client.execute({
        sql: `UPDATE books SET slug = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [tryS, MIRACLES_ID],
      });
      db.prepare(`UPDATE books SET slug = ?, updated_at = datetime('now') WHERE id = ?`).run(tryS, MIRACLES_ID);
    }
  } else {
    if (APPLY) {
      await client.execute({
        sql: `UPDATE books SET slug = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [NEW_SLUG, MIRACLES_ID],
      });
      db.prepare(`UPDATE books SET slug = ?, updated_at = datetime('now') WHERE id = ?`).run(NEW_SLUG, MIRACLES_ID);
      // Verify
      const v = await client.execute({ sql: `SELECT slug FROM books WHERE id = ?`, args: [MIRACLES_ID] });
      console.log(`  ✓ slug now "${v.rows[0].slug}" on Turso`);
    } else {
      console.log(`  (dry-run) would set slug="${NEW_SLUG}"`);
    }
  }

  db.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
