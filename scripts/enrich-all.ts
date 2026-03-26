/**
 * Enrich ALL books in the database that lack summaries and content ratings.
 *
 * Usage: npx tsx scripts/enrich-all.ts
 *
 * Stops gracefully on API exhaustion (Brave or Grok credits).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import { sql } from "drizzle-orm";

const DELAY_MS = 1500; // Delay between books

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Find ALL books that need enrichment (no user filter):
  // - No summary AND no content ratings
  const needsEnrichment = await db.all(sql`
    SELECT DISTINCT b.id, b.title
    FROM books b
    LEFT JOIN book_category_ratings bcr ON bcr.book_id = b.id
    WHERE b.summary IS NULL
    AND bcr.id IS NULL
    ORDER BY b.title
  `) as { id: string; title: string }[];

  console.log(`=== Enriching ${needsEnrichment.length} books ===\n`);

  let success = 0;
  let failed = 0;
  let exhausted = false;

  for (let i = 0; i < needsEnrichment.length; i++) {
    const book = needsEnrichment[i];
    const progress = `[${i + 1}/${needsEnrichment.length}]`;

    try {
      console.log(`${progress} Enriching: ${book.title}`);
      await enrichBook(book.id);
      success++;
      console.log(`  ✓ Done`);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);

      if (code === "API_EXHAUSTED") {
        console.error(`\n⚠️  API EXHAUSTED: ${msg}`);
        console.error(`Stopping enrichment. ${success} books enriched, ${failed} failed.`);
        console.error(`Remaining: ${needsEnrichment.length - i - 1} books still need enrichment.`);
        console.error(`\nCheck your Brave Search and Grok (xAI) credit balances, then re-run this script.`);
        exhausted = true;
        break;
      }

      failed++;
      console.error(`  ✗ Failed: ${msg}`);
    }

    // Rate limit
    if (i < needsEnrichment.length - 1) {
      await delay(DELAY_MS);
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total attempted: ${success + failed}`);
  console.log(`Total remaining: ${needsEnrichment.length - success - failed}`);
  if (exhausted) {
    console.log(`\n⚠️  Script stopped due to API exhaustion.`);
    process.exit(2);
  }
}

main().catch(console.error);
