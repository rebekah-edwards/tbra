/**
 * Batch enrichment script — runs enrichBook() on all books missing content ratings.
 * Prioritizes the user's personal library first, then remaining books.
 * Usage: npx tsx src/db/enrich-all.ts
 *        npx tsx src/db/enrich-all.ts --force   (re-enrich all books)
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "@/db";
import { books, bookCategoryRatings, userBookState } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { enrichBook } from "@/lib/enrichment/enrich-book";

async function main() {
  const force = process.argv.includes("--force");

  // Find all books that have zero ratings
  const allBooks = await db.select({ id: books.id, title: books.title }).from(books);

  const booksWithRatings = await db
    .select({ bookId: bookCategoryRatings.bookId })
    .from(bookCategoryRatings)
    .groupBy(bookCategoryRatings.bookId);

  const ratedBookIds = new Set(booksWithRatings.map((r) => r.bookId));

  // Get all book IDs in any user's library (prioritize these)
  const libraryRows = await db
    .select({ bookId: userBookState.bookId })
    .from(userBookState)
    .groupBy(userBookState.bookId);
  const libraryBookIds = new Set(libraryRows.map((r) => r.bookId));

  const booksToEnrich = force
    ? allBooks
    : allBooks.filter((b) => !ratedBookIds.has(b.id));

  // Split into library-first and everything else
  const libraryBooks = booksToEnrich.filter((b) => libraryBookIds.has(b.id));
  const otherBooks = booksToEnrich.filter((b) => !libraryBookIds.has(b.id));
  const targets = [...libraryBooks, ...otherBooks];

  console.log(
    `Found ${booksToEnrich.length} books to enrich (${libraryBooks.length} in user libraries, ${otherBooks.length} other)`
  );

  if (targets.length === 0) {
    console.log("All books have ratings. Use --force to re-enrich all books.");
    return;
  }

  let enrichedCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const book = targets[i];
    const isLibrary = libraryBookIds.has(book.id);
    console.log(
      `\n[${i + 1}/${targets.length}]${isLibrary ? " [LIBRARY]" : ""} Enriching: ${book.title}`
    );

    try {
      await enrichBook(book.id);
      console.log(`  ✓ Done`);
      enrichedCount++;
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === "API_EXHAUSTED") {
        console.error(`  ✗ API exhausted — stopping. Enriched ${enrichedCount} books this run.`);
        break;
      }
      console.error(`  ✗ Failed:`, err);
    }

    // Rate-limit: wait 2 seconds between books
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\nBatch enrichment complete! Enriched ${enrichedCount} books.`);
}

main().catch(console.error);
