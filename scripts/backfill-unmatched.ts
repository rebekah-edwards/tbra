/**
 * One-time backfill script for books imported without Open Library data.
 *
 * Strategy:
 * 1. Books with ISBN from CSV → try OL ISBN lookup → upgrade to full record
 * 2. Books without ISBN → retry title+author text search on OL
 * 3. Still unmatched → trigger enrichBook() for Brave+Grok analysis
 *
 * Also stores ISBNs/ASINs from the CSV onto existing book records.
 *
 * Usage: npx tsx scripts/backfill-unmatched.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db";
import { books, bookAuthors, authors, bookGenres, genres } from "@/db/schema";
import { eq, isNull } from "drizzle-orm";
import { searchOpenLibrary, fetchOpenLibraryWork, findOldestHardcoverCover, normalizeGenres, buildCoverUrl } from "@/lib/openlibrary";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import fs from "fs";

const OL_DELAY = 500;
const CSV_PATH = "/Users/clankeredwards/Desktop/7aafbe901e38dc752adeef40a1a9fe29d05c19118749ac6cafa7e82ea935616c.csv";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse CSV to build a map of title → ISBN/ASIN
function buildCsvIdMap(): Map<string, { isbn: string | null; asin: string | null }> {
  const text = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = text.split("\n");
  const map = new Map<string, { isbn: string | null; asin: string | null }>();

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse — title is first column, ISBN/UID is 4th
    const match = lines[i].match(/^([^,]+),([^,]*),([^,]*),([^,]*)/);
    if (!match) continue;
    const title = match[1].replace(/^"|"$/g, "").trim();
    const uid = match[4].replace(/^"|"$/g, "").trim();

    let isbn: string | null = null;
    let asin: string | null = null;
    const clean = uid.replace(/[-\s]/g, "");
    if (/^\d{10,13}$/.test(clean)) isbn = clean;
    else if (/^B[A-Z0-9]{9}$/.test(clean)) asin = clean;

    map.set(title.toLowerCase(), { isbn, asin });
  }
  return map;
}

async function main() {
  console.log("=== Backfill Unmatched Books ===\n");

  // Get all books without OL key
  const unmatched = await db
    .select({
      id: books.id,
      title: books.title,
      isbn10: books.isbn10,
      isbn13: books.isbn13,
      asin: books.asin,
    })
    .from(books)
    .where(isNull(books.openLibraryKey))
    .all();

  console.log(`Found ${unmatched.length} books without OL key\n`);

  // Build ISBN/ASIN map from CSV
  const csvIdMap = buildCsvIdMap();

  let upgraded = 0;
  let enriched = 0;
  let failed = 0;

  for (const book of unmatched) {
    // Get identifiers: prefer DB values, then CSV
    const csvIds = csvIdMap.get(book.title.toLowerCase());
    const isbn = book.isbn13 ?? book.isbn10 ?? csvIds?.isbn ?? null;
    const asin = book.asin ?? csvIds?.asin ?? null;

    // Store identifiers on the book record if missing
    if ((isbn || asin) && !book.isbn13 && !book.isbn10 && !book.asin) {
      await db.update(books).set({
        isbn13: isbn?.length === 13 ? isbn : null,
        isbn10: isbn?.length === 10 ? isbn : null,
        asin: asin,
      }).where(eq(books.id, book.id));
    }

    // Get authors for text search
    const bookAuthorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, book.id))
      .all();
    const authorName = bookAuthorRows[0]?.name ?? null;

    // Strategy 1: ISBN lookup
    let olMatch = null;
    if (isbn) {
      console.log(`  [ISBN] ${book.title} → ${isbn}`);
      await delay(OL_DELAY);
      const results = await searchOpenLibrary(isbn, 5);
      if (results.length > 0) {
        olMatch = results[0]; // Trust ISBN match
      }
    }

    // Strategy 2: Title+author text search (retry)
    if (!olMatch) {
      const query = authorName ? `${book.title} ${authorName}` : book.title;
      console.log(`  [TEXT] ${book.title} → "${query}"`);
      await delay(OL_DELAY);
      const results = await searchOpenLibrary(query, 5);
      // Be more lenient with matching for backfill
      if (results.length > 0) {
        const titleLower = book.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        olMatch = results.find((r) => {
          const rLower = r.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
          return rLower.includes(titleLower) || titleLower.includes(rLower);
        }) ?? null;
      }
    }

    if (olMatch) {
      // Upgrade the book with OL data
      try {
        const workData = await fetchOpenLibraryWork(olMatch.key);
        const hardcoverCover = await findOldestHardcoverCover(olMatch.key);
        const coverId = hardcoverCover?.coverId ?? workData?.coverId ?? olMatch.cover_i ?? null;
        const coverUrl = coverId ? buildCoverUrl(coverId, "L") : null;

        const olGenres = normalizeGenres(workData?.subjects ?? []);
        const NONFICTION = new Set(["Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime", "Philosophy"]);
        const isFiction = !olGenres.some((g: string) => NONFICTION.has(g));

        // Update the book record
        await db.update(books).set({
          openLibraryKey: olMatch.key,
          description: workData?.description ?? null,
          publicationYear: olMatch.first_publish_year ?? null,
          coverImageUrl: coverUrl,
          isFiction,
          isbn13: olMatch.isbn?.find((i: string) => i.length === 13) ?? book.isbn13 ?? (isbn?.length === 13 ? isbn : null),
          isbn10: olMatch.isbn?.find((i: string) => i.length === 10) ?? book.isbn10 ?? (isbn?.length === 10 ? isbn : null),
          pages: olMatch.number_of_pages_median ?? null,
        }).where(eq(books.id, book.id));

        // Link genres
        for (const genreName of olGenres.slice(0, 8)) {
          let genre = await db.select().from(genres).where(eq(genres.name, genreName)).get();
          if (!genre) {
            [genre] = await db.insert(genres).values({ name: genreName }).returning();
          }
          await db.insert(bookGenres).values({ bookId: book.id, genreId: genre.id }).onConflictDoNothing();
        }

        console.log(`  ✓ UPGRADED: ${book.title} → ${olMatch.key}`);
        upgraded++;

        // Also trigger enrichment for the newly-upgraded book
        enrichBook(book.id).catch(() => {});

      } catch (err) {
        console.error(`  ✗ Error upgrading ${book.title}:`, err);
        failed++;
      }
    } else {
      // Strategy 3: No OL match — trigger enrichment for summary/ratings
      console.log(`  → ENRICH ONLY: ${book.title}`);
      enrichBook(book.id).catch((err) => {
        console.error(`  ✗ Enrichment error for ${book.title}:`, err);
      });
      enriched++;
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Upgraded to full OL records: ${upgraded}`);
  console.log(`Enrichment-only (no OL match): ${enriched}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total processed: ${unmatched.length}`);
}

main().catch(console.error);
