/**
 * Backfill missing publication years by querying Open Library editions.
 *
 * Run: npx tsx scripts/backfill-publication-year.ts
 */

import "dotenv/config";
import Database from "better-sqlite3";
import path from "path";
import { findOldestHardcoverCover, searchOpenLibrary } from "../src/lib/openlibrary";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BookRow {
  id: string;
  title: string;
  open_library_key: string;
}

async function main() {
  const booksToFix = db.prepare(`
    SELECT id, title, open_library_key
    FROM books
    WHERE open_library_key IS NOT NULL
      AND publication_year IS NULL
  `).all() as BookRow[];

  console.log(`Found ${booksToFix.length} books with missing publication year\n`);

  const updateStmt = db.prepare("UPDATE books SET publication_year = ? WHERE id = ?");
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < booksToFix.length; i++) {
    const book = booksToFix[i];

    try {
      // Try 1: Get year from editions
      const { year: editionYear } = await findOldestHardcoverCover(book.open_library_key);
      await delay(400);

      if (editionYear) {
        updateStmt.run(editionYear, book.id);
        updated++;
        console.log(`[${i + 1}/${booksToFix.length}] "${book.title}" → ${editionYear} (from editions)`);
        continue;
      }

      // Try 2: Search OL for first_publish_year
      const results = await searchOpenLibrary(book.title, 1);
      await delay(400);

      const match = results.find((r) => r.key === book.open_library_key);
      if (match?.first_publish_year) {
        updateStmt.run(match.first_publish_year, book.id);
        updated++;
        console.log(`[${i + 1}/${booksToFix.length}] "${book.title}" → ${match.first_publish_year} (from search)`);
        continue;
      }

      skipped++;
      if ((i + 1) % 10 === 0) {
        console.log(`[${i + 1}/${booksToFix.length}] progress...`);
      }
    } catch (err) {
      console.error(`[${i + 1}/${booksToFix.length}] Error for "${book.title}":`, err);
      skipped++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}`);
  db.close();
}

main();
