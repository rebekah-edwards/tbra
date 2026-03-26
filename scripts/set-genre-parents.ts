/**
 * Backfill script: set parentGenreId on existing genres and ensure
 * parent genres are linked to books that have child genres.
 *
 * Run: npx tsx scripts/set-genre-parents.ts
 */

import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Parent → children mapping (canonical names)
const PARENT_CHILDREN: Record<string, string[]> = {
  "Sci-Fi": ["Space Opera", "Hard Science Fiction", "Hard Sci-Fi", "Cyberpunk", "Space Western"],
  "Fantasy": ["Epic Fantasy", "Dark Fantasy", "Urban Fantasy", "Cozy Fantasy", "High Fantasy", "Sword and Sorcery", "Portal Fantasy", "Gaslamp Fantasy"],
  "Horror": ["Gothic Horror", "Cosmic Horror", "Body Horror", "Folk Horror", "Slasher"],
  "Mystery": ["Cozy Mystery"],
  "Romance": ["Romantasy", "Regency Romance", "Dark Romance"],
  "Humor": ["Dark Humor", "Satire"],
  "LitRPG": ["GameLit"],
  "Survival": ["Survival Fiction"],
  "Thriller": ["Conspiracy Thriller", "Psychological Thriller", "Techno-Thriller"],
  "Historical Fiction": ["Historical Fantasy", "Historical Romance", "Historical Mystery", "Historical Horror"],
};

// Build a case-insensitive lookup: lowered name → genre row
type GenreRow = { id: string; name: string; parent_genre_id: string | null };

function getAllGenres(): GenreRow[] {
  return db.prepare("SELECT id, name, parent_genre_id FROM genres").all() as GenreRow[];
}

function findGenreByName(allGenres: GenreRow[], name: string): GenreRow | undefined {
  const lower = name.toLowerCase();
  return allGenres.find((g) => g.name.toLowerCase() === lower);
}

function createGenre(name: string): GenreRow {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO genres (id, name) VALUES (?, ?)").run(id, name);
  console.log(`  Created genre: "${name}"`);
  return { id, name, parent_genre_id: null };
}

function main() {
  let allGenres = getAllGenres();
  console.log(`Found ${allGenres.length} genres in DB\n`);

  let parentsSet = 0;
  let linksAdded = 0;

  for (const [parentName, children] of Object.entries(PARENT_CHILDREN)) {
    // Find or create parent genre
    let parent = findGenreByName(allGenres, parentName);
    if (!parent) {
      parent = createGenre(parentName);
      allGenres.push(parent);
    }

    for (const childName of children) {
      const child = findGenreByName(allGenres, childName);
      if (!child) {
        console.log(`  Child genre "${childName}" not found in DB — skipping`);
        continue;
      }

      // Set parentGenreId on child
      if (child.parent_genre_id !== parent.id) {
        db.prepare("UPDATE genres SET parent_genre_id = ? WHERE id = ?").run(parent.id, child.id);
        child.parent_genre_id = parent.id;
        console.log(`  Set parent: "${childName}" → "${parentName}"`);
        parentsSet++;
      }

      // Find all books that have the child genre but NOT the parent (only valid book IDs)
      const booksNeedingParent = db.prepare(`
        SELECT bg.book_id FROM book_genres bg
        INNER JOIN books b ON b.id = bg.book_id
        WHERE bg.genre_id = ?
        AND bg.book_id NOT IN (
          SELECT book_id FROM book_genres WHERE genre_id = ?
        )
      `).all(child.id, parent.id) as { book_id: string }[];

      if (booksNeedingParent.length > 0) {
        const insertStmt = db.prepare("INSERT OR IGNORE INTO book_genres (book_id, genre_id) VALUES (?, ?)");
        const insertMany = db.transaction((bookIds: string[]) => {
          for (const bookId of bookIds) {
            insertStmt.run(bookId, parent.id);
          }
        });
        insertMany(booksNeedingParent.map((b) => b.book_id));
        console.log(`  Linked parent "${parentName}" to ${booksNeedingParent.length} books that had "${childName}"`);
        linksAdded += booksNeedingParent.length;
      }
    }
  }

  console.log(`\nDone! Set ${parentsSet} parent relationships, added ${linksAdded} parent genre links to books.`);
  db.close();
}

main();
