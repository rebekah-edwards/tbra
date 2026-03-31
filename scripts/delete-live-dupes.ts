/**
 * Delete books from Turso that were removed locally by dedup.
 * Compares local book IDs against live, deletes orphans from live.
 *
 * Usage:
 *   npx tsx scripts/delete-live-dupes.ts --dry-run
 *   npx tsx scripts/delete-live-dupes.ts
 */

import Database from "libsql";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const local = new Database("data/tbra.db");
  const live = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  console.log(DRY_RUN ? "DRY RUN" : "LIVE RUN");

  // Get all local book IDs
  const localIds = new Set(
    local.prepare("SELECT id FROM books").all().map((r: any) => r.id as string)
  );
  console.log(`Local books: ${localIds.size}`);

  // Get all live book IDs
  const liveBooks = await live.execute("SELECT id, title FROM books");
  console.log(`Live books: ${liveBooks.rows.length}`);

  const toDelete: { id: string; title: string }[] = [];
  for (const row of liveBooks.rows) {
    if (!localIds.has(row.id as string)) {
      toDelete.push({ id: row.id as string, title: row.title as string });
    }
  }

  console.log(`\nBooks to delete from live: ${toDelete.length}\n`);

  if (toDelete.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  // Show first 20
  for (const b of toDelete.slice(0, 20)) {
    console.log(`  ${b.title}`);
  }
  if (toDelete.length > 20) console.log(`  ... and ${toDelete.length - 20} more`);

  if (DRY_RUN) {
    console.log("\nDry run — no changes made.");
    return;
  }

  // Delete in batches of 50
  const REF_TABLES = [
    "book_authors", "book_genres", "book_series", "book_narrators",
    "book_category_ratings", "enrichment_log", "editions",
    "landing_page_books", "shelf_books", "user_hidden_books",
    "user_owned_editions", "up_next", "user_favorite_books",
    "reading_notes", "reading_sessions", "user_book_ratings",
    "user_book_state", "reported_issues", "links",
  ];

  let deleted = 0;
  for (const book of toDelete) {
    // Delete reviews + their child tables
    const reviews = await live.execute({ sql: "SELECT id FROM user_book_reviews WHERE book_id = ?", args: [book.id] });
    for (const r of reviews.rows) {
      await live.execute({ sql: "DELETE FROM user_book_dimension_ratings WHERE review_id = ?", args: [r.id as string] });
      await live.execute({ sql: "DELETE FROM review_descriptor_tags WHERE review_id = ?", args: [r.id as string] });
      await live.execute({ sql: "DELETE FROM review_helpful_votes WHERE review_id = ?", args: [r.id as string] });
    }
    await live.execute({ sql: "DELETE FROM user_book_reviews WHERE book_id = ?", args: [book.id] });

    // Delete category rating citations
    const catRatings = await live.execute({ sql: "SELECT id FROM book_category_ratings WHERE book_id = ?", args: [book.id] });
    for (const r of catRatings.rows) {
      await live.execute({ sql: "DELETE FROM rating_citations WHERE rating_id = ?", args: [r.id as string] });
    }

    // Delete from all reference tables
    for (const table of REF_TABLES) {
      try {
        await live.execute({ sql: `DELETE FROM ${table} WHERE book_id = ?`, args: [book.id] });
      } catch { /* table might not exist or no FK */ }
    }

    // Delete the book itself
    await live.execute({ sql: "DELETE FROM books WHERE id = ?", args: [book.id] });

    deleted++;
    if (deleted % 100 === 0) console.log(`  Deleted ${deleted}/${toDelete.length}...`);
  }

  console.log(`\nDone. Deleted ${deleted} books from live.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
