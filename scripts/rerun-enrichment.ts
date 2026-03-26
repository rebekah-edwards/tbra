/**
 * Re-run enrichment with Grok-4 for all previously enriched books.
 * Skips Project Hail Mary (human-verified).
 */

import { config } from "dotenv";
import { resolve } from "path";
// Load env from tbra/.env.local
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "@/db";
import {
  books,
  bookCategoryRatings,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { enrichBook } from "@/lib/enrichment/enrich-book";

const PROJECT_HAIL_MARY_ID = "0b1718b8-d5c0-40b5-8c62-6d826434ce45";

async function main() {
  console.log("=== RE-RUNNING ENRICHMENT WITH GROK-4 ===");
  console.log(`Started at: ${new Date().toISOString()}`);

  // Get all books
  const allBooks = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .all();

  // Filter out Project Hail Mary and find books with existing ratings
  const booksToEnrich: { id: string; title: string }[] = [];
  for (const book of allBooks) {
    if (book.id === PROJECT_HAIL_MARY_ID) continue;
    const ratings = await db
      .select({ id: bookCategoryRatings.id })
      .from(bookCategoryRatings)
      .where(eq(bookCategoryRatings.bookId, book.id))
      .limit(1);
    if (ratings.length > 0) {
      booksToEnrich.push(book);
    }
  }

  console.log(`Books to re-enrich: ${booksToEnrich.length}`);

  let completed = 0;
  let failed = 0;

  for (const book of booksToEnrich) {
    try {
      console.log(`[${completed + failed + 1}/${booksToEnrich.length}] "${book.title}"`);
      await enrichBook(book.id);
      completed++;
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${err}`);
    }
    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(`\nDone! Completed: ${completed}, Failed: ${failed}`);
  console.log(`Finished at: ${new Date().toISOString()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
