/**
 * Enrich books prioritized by user shelves first, then orphans.
 *
 * Usage: npx tsx scripts/enrich-user-priority.ts
 *
 * Priority order:
 * 1. Books on user shelves missing content ratings
 * 2. Books on user shelves missing summaries
 * 3. Books on user shelves missing covers
 * 4. All other unenriched books (orphans)
 *
 * Respects Google Books daily quota (stops at cap).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import { sql } from "drizzle-orm";

const DELAY_MS = 1200;
const MAX_GOOGLE_BOOKS = 780; // Leave headroom under 800

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let googleBooksUsed = 0;

  // Phase 1: User-shelved books missing content ratings (most impactful)
  const userMissingRatings = await db.all(sql`
    SELECT DISTINCT b.id, b.title
    FROM books b
    JOIN user_book_state ubs ON b.id = ubs.book_id
    LEFT JOIN book_category_ratings bcr ON bcr.book_id = b.id
    WHERE bcr.id IS NULL
    AND b.visibility = 'public'
    ORDER BY (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) DESC
  `) as { id: string; title: string }[];

  // Phase 2: User-shelved books missing summaries (but have ratings)
  const userMissingSummary = await db.all(sql`
    SELECT DISTINCT b.id, b.title
    FROM books b
    JOIN user_book_state ubs ON b.id = ubs.book_id
    WHERE (b.summary IS NULL OR b.summary = '')
    AND b.id NOT IN (
      SELECT DISTINCT b2.id FROM books b2
      LEFT JOIN book_category_ratings bcr ON bcr.book_id = b2.id
      JOIN user_book_state ubs2 ON b2.id = ubs2.book_id
      WHERE bcr.id IS NULL
    )
    AND b.visibility = 'public'
    ORDER BY (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) DESC
  `) as { id: string; title: string }[];

  // Phase 3: All other unenriched books (orphans)
  const orphans = await db.all(sql`
    SELECT DISTINCT b.id, b.title
    FROM books b
    LEFT JOIN book_category_ratings bcr ON bcr.book_id = b.id
    LEFT JOIN user_book_state ubs ON b.id = ubs.book_id
    WHERE bcr.id IS NULL
    AND (b.summary IS NULL OR b.summary = '')
    AND ubs.book_id IS NULL
    AND b.visibility = 'public'
    ORDER BY b.title
  `) as { id: string; title: string }[];

  console.log(`=== Enrichment Priority Queue ===`);
  console.log(`Phase 1 - User books missing ratings: ${userMissingRatings.length}`);
  console.log(`Phase 2 - User books missing summaries: ${userMissingSummary.length}`);
  console.log(`Phase 3 - Orphan books: ${orphans.length}`);
  console.log(`Total: ${userMissingRatings.length + userMissingSummary.length + orphans.length}`);
  console.log(`Google Books cap: ${MAX_GOOGLE_BOOKS}\n`);

  const allBooks = [
    ...userMissingRatings.map(b => ({ ...b, phase: 1 })),
    ...userMissingSummary.map(b => ({ ...b, phase: 2 })),
    ...orphans.map(b => ({ ...b, phase: 3 })),
  ];

  let success = 0;
  let failed = 0;
  let currentPhase = 0;

  for (let i = 0; i < allBooks.length; i++) {
    const book = allBooks[i];

    if (book.phase !== currentPhase) {
      currentPhase = book.phase;
      console.log(`\n--- Phase ${currentPhase} ---\n`);
    }

    const progress = `[${i + 1}/${allBooks.length}]`;

    try {
      console.log(`${progress} Enriching: ${book.title}`);
      await enrichBook(book.id, { skipGoogleBooks: googleBooksUsed >= MAX_GOOGLE_BOOKS });
      success++;
      googleBooksUsed++; // Conservative: assume each enrichment uses 1 GBooks call
      console.log(`  ✓ Done (GBooks used: ~${googleBooksUsed})`);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);

      if (code === "API_EXHAUSTED") {
        console.error(`\n⚠️  API EXHAUSTED: ${msg}`);
        console.error(`Stopping. ${success} enriched, ${failed} failed, ~${googleBooksUsed} GBooks calls.`);
        break;
      }

      failed++;
      console.error(`  ✗ Failed: ${msg}`);
    }

    if (i < allBooks.length - 1) {
      await delay(DELAY_MS);
    }
  }

  console.log(`\n=== Final Results ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  console.log(`Google Books calls (est): ${googleBooksUsed}`);
  console.log(`Remaining: ${allBooks.length - success - failed}`);
}

main().catch(console.error);
