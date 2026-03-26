/**
 * Re-enrich all books in the database.
 * This will update series info, audiobook lengths, content ratings, summaries, and tags.
 * Run with: npx tsx scripts/re-enrich-all.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db";
import { books } from "../src/db/schema";
import { enrichBook } from "../src/lib/enrichment/enrich-book";

async function main() {
  const allBooks = await db.select({ id: books.id, title: books.title }).from(books);
  console.log(`Found ${allBooks.length} books to re-enrich`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < allBooks.length; i++) {
    const book = allBooks[i];
    console.log(`\n[${i + 1}/${allBooks.length}] Enriching: ${book.title}`);
    try {
      await enrichBook(book.id);
      success++;
    } catch (err) {
      console.error(`  FAILED: ${err}`);
      failed++;
    }
    // Small delay between books to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n\nDone! Success: ${success}, Failed: ${failed}`);
  process.exit(0);
}

main();
