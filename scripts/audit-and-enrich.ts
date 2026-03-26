/**
 * Audit script: Clean up series data + re-run enrichment with Grok-4
 *
 * 1. Remove book_series entries for "series" with only 1 book (standalone miscategorization)
 * 2. Remove orphaned series entries
 * 3. Re-run enrichment for all books except Project Hail Mary
 */

import { db } from "@/db";
import {
  books,
  bookSeries,
  series,
  bookCategoryRatings,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { enrichBook } from "@/lib/enrichment/enrich-book";

const PROJECT_HAIL_MARY_ID = "0b1718b8-d5c0-40b5-8c62-6d826434ce45";

async function cleanupSeries() {
  console.log("=== SERIES CLEANUP ===");

  // Find series with only 1 book — these are likely misclassified standalone books
  const singleBookSeries = await db.all(sql`
    SELECT s.id, s.name, COUNT(bs.book_id) as book_count
    FROM series s
    JOIN book_series bs ON s.id = bs.series_id
    GROUP BY s.id
    HAVING COUNT(bs.book_id) = 1
  `) as { id: string; name: string; book_count: number }[];

  // Known real series that just haven't been fully imported yet — don't remove these
  const KNOWN_REAL_SERIES = new Set([
    "harry potter", "the hunger games", "dune", "the inheritance games",
    "ready player one", "the far reaches",
  ]);

  let removedLinks = 0;
  let removedSeries = 0;

  for (const s of singleBookSeries) {
    if (KNOWN_REAL_SERIES.has(s.name.toLowerCase())) {
      console.log(`  Keeping known series: "${s.name}" (will be populated by enrichment)`);
      continue;
    }

    // Remove the book_series link
    await db.delete(bookSeries).where(eq(bookSeries.seriesId, s.id));
    removedLinks++;

    // Remove the orphaned series
    await db.delete(series).where(eq(series.id, s.id));
    removedSeries++;

    console.log(`  Removed standalone series: "${s.name}"`);
  }

  console.log(`Cleaned up ${removedLinks} false series links, ${removedSeries} orphaned series entries`);
}

async function rerunEnrichment() {
  console.log("\n=== RE-RUNNING ENRICHMENT WITH GROK-4 ===");

  // Get all books
  const allBooks = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .all();

  console.log(`Total books: ${allBooks.length}`);

  // Filter out Project Hail Mary
  const booksToEnrich = allBooks.filter((b) => b.id !== PROJECT_HAIL_MARY_ID);
  console.log(`Books to enrich: ${booksToEnrich.length} (skipping Project Hail Mary)`);

  // Only re-enrich books that already have ratings (were previously enriched)
  // This avoids enriching bare cascade-imported books that may be duplicates
  const booksWithRatings = [];
  for (const book of booksToEnrich) {
    const ratings = await db
      .select({ id: bookCategoryRatings.id })
      .from(bookCategoryRatings)
      .where(eq(bookCategoryRatings.bookId, book.id))
      .limit(1);
    if (ratings.length > 0) {
      booksWithRatings.push(book);
    }
  }

  console.log(`Books with existing ratings to re-enrich: ${booksWithRatings.length}`);

  let completed = 0;
  let failed = 0;

  for (const book of booksWithRatings) {
    try {
      console.log(`\n[${completed + failed + 1}/${booksWithRatings.length}] Enriching: "${book.title}"`);
      await enrichBook(book.id);
      completed++;
      console.log(`  ✓ Done (${completed} completed, ${failed} failed)`);
    } catch (err) {
      failed++;
      console.error(`  ✗ Failed: ${err}`);
    }

    // Rate limit — wait between enrichments to avoid hitting API limits
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(`\n=== ENRICHMENT COMPLETE ===`);
  console.log(`Completed: ${completed}, Failed: ${failed}`);
}

async function main() {
  await cleanupSeries();
  await rerunEnrichment();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
