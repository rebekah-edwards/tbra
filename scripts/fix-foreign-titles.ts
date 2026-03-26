/**
 * One-time script to fix foreign-language titles in the database.
 * Scans all books with OL keys, checks if they have an English edition title
 * that differs from the stored title, and updates if so.
 *
 * Run with: npx tsx scripts/fix-foreign-titles.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/db";
import { books } from "../src/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { findEnglishEditionTitle } from "../src/lib/openlibrary";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Check if a title looks like it's in a non-English language (heuristic) */
function mightBeForeignTitle(title: string): boolean {
  // Common non-ASCII characters in foreign titles
  if (/[àáâãäåèéêëìíîïòóôõöùúûüñçæøåßðþ]/i.test(title)) return true;
  // Common Spanish/Portuguese/French words that wouldn't appear in English titles
  const foreignWords = /\b(del|las|los|des|une|der|das|und|och|och|fra|від)\b/i;
  if (foreignWords.test(title)) return true;
  return false;
}

async function main() {
  console.log("=== FIXING FOREIGN-LANGUAGE TITLES ===");

  // Get all books with OL keys
  const allBooks = await db
    .select({ id: books.id, title: books.title, olKey: books.openLibraryKey })
    .from(books)
    .where(isNotNull(books.openLibraryKey));

  console.log(`Total books with OL keys: ${allBooks.length}`);

  // First pass: check books with likely foreign titles
  const candidates = allBooks.filter((b) => mightBeForeignTitle(b.title));
  console.log(`Books with likely foreign titles: ${candidates.length}`);

  // Also check ALL books (some foreign titles use ASCII, e.g. "Cadaver exquisito" without accent)
  // But prioritize the likely ones first
  const allToCheck = [
    ...candidates,
    ...allBooks.filter((b) => !candidates.includes(b)),
  ];

  let fixed = 0;
  let checked = 0;
  let errors = 0;

  for (const book of allToCheck) {
    if (!book.olKey) continue;

    checked++;
    if (checked % 50 === 0) {
      console.log(`  Checked ${checked}/${allToCheck.length}, fixed ${fixed} so far...`);
    }

    try {
      await delay(300); // Rate limit
      const englishTitle = await findEnglishEditionTitle(book.olKey);

      if (englishTitle && englishTitle.toLowerCase() !== book.title.toLowerCase()) {
        console.log(`  FIXING: "${book.title}" → "${englishTitle}"`);
        await db
          .update(books)
          .set({ title: englishTitle, updatedAt: new Date().toISOString() })
          .where(eq(books.id, book.id));
        fixed++;
      }
    } catch (err) {
      errors++;
      console.warn(`  Error checking "${book.title}":`, err);
    }

    // Stop after checking likely foreign titles if we want a quick run
    // Remove this break to check ALL books (will take much longer)
    if (checked >= candidates.length && candidates.length > 0) {
      console.log(`\nChecked all ${candidates.length} likely foreign titles.`);
      console.log(`To check ALL ${allBooks.length} books, remove the early-stop in the script.`);
      break;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Checked: ${checked}, Fixed: ${fixed}, Errors: ${errors}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
