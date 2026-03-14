/**
 * Batch enrichment script — runs enrichBook() on all books missing content ratings.
 * Usage: npx tsx src/db/enrich-all.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "@/db";
import { books, bookCategoryRatings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { enrichBook } from "@/lib/enrichment/enrich-book";

async function main() {
  // Find all books that have zero ratings
  const allBooks = await db.select({ id: books.id, title: books.title }).from(books);

  const booksWithRatings = await db
    .select({ bookId: bookCategoryRatings.bookId })
    .from(bookCategoryRatings)
    .groupBy(bookCategoryRatings.bookId);

  const ratedBookIds = new Set(booksWithRatings.map((r) => r.bookId));
  const booksToEnrich = allBooks.filter((b) => !ratedBookIds.has(b.id));

  console.log(
    `Found ${booksToEnrich.length} books without ratings (${allBooks.length} total)`
  );

  if (booksToEnrich.length === 0) {
    // Also re-enrich books that have ratings (to update summaries/tags)
    console.log("All books have ratings. Use --force to re-enrich all books.");
    if (!process.argv.includes("--force")) return;
  }

  const targets = process.argv.includes("--force") ? allBooks : booksToEnrich;

  for (let i = 0; i < targets.length; i++) {
    const book = targets[i];
    console.log(
      `\n[${i + 1}/${targets.length}] Enriching: ${book.title}`
    );

    try {
      await enrichBook(book.id);
      console.log(`  ✓ Done`);
    } catch (err) {
      console.error(`  ✗ Failed:`, err);
    }

    // Rate-limit: wait 2 seconds between books
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("\nBatch enrichment complete!");
}

main().catch(console.error);
