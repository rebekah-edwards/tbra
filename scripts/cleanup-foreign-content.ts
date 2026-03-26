/**
 * Comprehensive foreign title + cover cleanup.
 * - Fixes foreign titles using findEnglishEditionTitle
 * - Replaces foreign-edition covers using findEnglishCover
 * - Flags fully foreign works (no English edition exists)
 *
 * Run: npx tsx scripts/cleanup-foreign-content.ts
 */

import Database from "better-sqlite3";
import path from "path";
import {
  findEnglishEditionTitle,
  findEnglishCover,
  buildCoverUrl,
} from "../src/lib/openlibrary";
import { isEnglishTitle } from "../src/lib/queries/books";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Heuristic: title contains non-ASCII accented chars or known foreign words */
function mightBeForeignTitle(title: string): boolean {
  if (/[àáâãäåèéêëìíîïòóôõöùúûüñçæøåßðþ]/i.test(title)) return true;
  if (/\b(del|las|los|des|une|der|das|und|och|fra|від)\b/i.test(title)) return true;
  return false;
}

interface BookRow {
  id: string;
  title: string;
  open_library_key: string;
  cover_image_url: string | null;
}

async function main() {
  console.log("=== FOREIGN CONTENT CLEANUP ===\n");

  const allBooks = db.prepare(`
    SELECT id, title, open_library_key, cover_image_url
    FROM books
    WHERE open_library_key IS NOT NULL
  `).all() as BookRow[];

  console.log(`Total books with OL keys: ${allBooks.length}`);

  // Identify candidates: likely foreign title or fails isEnglishTitle check
  const candidates = allBooks.filter(
    (b) => mightBeForeignTitle(b.title) || !isEnglishTitle(b.title)
  );
  console.log(`Books with likely foreign titles: ${candidates.length}\n`);

  const updateTitle = db.prepare("UPDATE books SET title = ?, updated_at = ? WHERE id = ?");
  const updateCover = db.prepare("UPDATE books SET cover_image_url = ?, updated_at = ? WHERE id = ?");

  let titlesFixed = 0;
  let coversFixed = 0;
  let flaggedForeign: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const book = candidates[i];
    const now = new Date().toISOString();

    try {
      // 1. Fix title
      await delay(400);
      const englishTitle = await findEnglishEditionTitle(book.open_library_key);

      if (!englishTitle) {
        // No English edition found at all — flag as fully foreign
        flaggedForeign.push(`"${book.title}" (${book.open_library_key})`);
        console.log(`[${i + 1}/${candidates.length}] FLAGGED foreign: "${book.title}"`);
        continue;
      }

      if (englishTitle.toLowerCase() !== book.title.toLowerCase()) {
        updateTitle.run(englishTitle, now, book.id);
        console.log(`[${i + 1}/${candidates.length}] Title: "${book.title}" → "${englishTitle}"`);
        titlesFixed++;
      }

      // 2. Check cover — try to find an English-edition cover
      await delay(400);
      const { coverId } = await findEnglishCover(book.open_library_key);

      if (coverId) {
        const newCoverUrl = buildCoverUrl(coverId, "L");
        if (newCoverUrl !== book.cover_image_url) {
          updateCover.run(newCoverUrl, now, book.id);
          console.log(`[${i + 1}/${candidates.length}] Cover updated for "${englishTitle || book.title}"`);
          coversFixed++;
        }
      }
    } catch (err) {
      console.error(`[${i + 1}/${candidates.length}] Error for "${book.title}":`, err);
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  Progress: ${i + 1}/${candidates.length}`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Titles fixed: ${titlesFixed}`);
  console.log(`Covers fixed: ${coversFixed}`);
  console.log(`Flagged as fully foreign: ${flaggedForeign.length}`);
  if (flaggedForeign.length > 0) {
    console.log(`\nForeign works (no English edition found):`);
    for (const f of flaggedForeign) {
      console.log(`  - ${f}`);
    }
  }

  db.close();
}

main();
