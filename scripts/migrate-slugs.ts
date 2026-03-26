/**
 * Migration script: Generate slugs for all existing books, series, and authors.
 *
 * 1. Add slug columns (if not exist)
 * 2. Generate slugs for all records
 * 3. Add unique indexes
 *
 * Run: npx tsx scripts/migrate-slugs.ts
 */

import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function normalize(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "-");
}

function generateBookSlug(title: string, authorName: string): string {
  const titleSlug = normalize(title);
  const authorSlug = normalize(authorName);
  if (!authorSlug) return titleSlug;
  return `${titleSlug}-${authorSlug}`;
}

function generateSeriesSlug(seriesName: string, authorName?: string): string {
  const nameSlug = normalize(seriesName);
  if (!authorName) return nameSlug;
  const authorSlug = normalize(authorName);
  if (!authorSlug) return nameSlug;
  return `${nameSlug}-${authorSlug}`;
}

function generateAuthorSlug(authorName: string): string {
  return normalize(authorName);
}

// ─── Step 1: Add columns ───

console.log("Adding slug columns...");

try {
  db.exec("ALTER TABLE books ADD COLUMN slug TEXT");
  console.log("  Added books.slug");
} catch (e: any) {
  if (e.message?.includes("duplicate column")) {
    console.log("  books.slug already exists");
  } else {
    throw e;
  }
}

try {
  db.exec("ALTER TABLE series ADD COLUMN slug TEXT");
  console.log("  Added series.slug");
} catch (e: any) {
  if (e.message?.includes("duplicate column")) {
    console.log("  series.slug already exists");
  } else {
    throw e;
  }
}

try {
  db.exec("ALTER TABLE authors ADD COLUMN slug TEXT");
  console.log("  Added authors.slug");
} catch (e: any) {
  if (e.message?.includes("duplicate column")) {
    console.log("  authors.slug already exists");
  } else {
    throw e;
  }
}

// ─── Step 2: Generate book slugs ───

console.log("\nGenerating book slugs...");

const allBooks = db.prepare(`
  SELECT b.id, b.title,
    (SELECT a.name FROM book_authors ba
     JOIN authors a ON ba.author_id = a.id
     WHERE ba.book_id = b.id AND ba.role = 'author'
     LIMIT 1) as author_name
  FROM books b
  WHERE b.slug IS NULL
`).all() as { id: string; title: string; author_name: string | null }[];

console.log(`  Found ${allBooks.length} books without slugs`);

const bookSlugSet = new Set<string>();
// Pre-populate with existing slugs
const existingSlugs = db.prepare("SELECT slug FROM books WHERE slug IS NOT NULL").all() as { slug: string }[];
for (const row of existingSlugs) bookSlugSet.add(row.slug);

const updateBookSlug = db.prepare("UPDATE books SET slug = ? WHERE id = ?");

const bookTransaction = db.transaction(() => {
  let count = 0;
  for (const book of allBooks) {
    let slug = generateBookSlug(book.title, book.author_name || "");

    // Handle collisions with numeric suffix
    let finalSlug = slug;
    let suffix = 2;
    while (bookSlugSet.has(finalSlug)) {
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }
    bookSlugSet.add(finalSlug);
    updateBookSlug.run(finalSlug, book.id);
    count++;
  }
  return count;
});

const bookCount = bookTransaction();
console.log(`  Updated ${bookCount} book slugs`);

// ─── Step 3: Generate author slugs ───

console.log("\nGenerating author slugs...");

const allAuthors = db.prepare(`
  SELECT id, name FROM authors WHERE slug IS NULL
`).all() as { id: string; name: string }[];

console.log(`  Found ${allAuthors.length} authors without slugs`);

const authorSlugSet = new Set<string>();
const existingAuthorSlugs = db.prepare("SELECT slug FROM authors WHERE slug IS NOT NULL").all() as { slug: string }[];
for (const row of existingAuthorSlugs) authorSlugSet.add(row.slug);

const updateAuthorSlug = db.prepare("UPDATE authors SET slug = ? WHERE id = ?");

const authorTransaction = db.transaction(() => {
  let count = 0;
  for (const author of allAuthors) {
    let slug = generateAuthorSlug(author.name);

    // Handle collisions with numeric suffix
    let finalSlug = slug;
    let suffix = 2;
    while (authorSlugSet.has(finalSlug)) {
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }
    authorSlugSet.add(finalSlug);
    updateAuthorSlug.run(finalSlug, author.id);
    count++;
  }
  return count;
});

const authorCount = authorTransaction();
console.log(`  Updated ${authorCount} author slugs`);

// ─── Step 4: Generate series slugs ───

console.log("\nGenerating series slugs...");

// For series: use the most common author. If multiple authors, omit author.
const allSeries = db.prepare(`
  SELECT s.id, s.name FROM series s WHERE s.slug IS NULL
`).all() as { id: string; name: string }[];

console.log(`  Found ${allSeries.length} series without slugs`);

const seriesSlugSet = new Set<string>();
const existingSeriesSlugs = db.prepare("SELECT slug FROM series WHERE slug IS NOT NULL").all() as { slug: string }[];
for (const row of existingSeriesSlugs) seriesSlugSet.add(row.slug);

const updateSeriesSlug = db.prepare("UPDATE series SET slug = ? WHERE id = ?");

// Get the most common author for a series
const getSeriesAuthorCounts = db.prepare(`
  SELECT a.name, COUNT(*) as cnt
  FROM book_series bs
  JOIN book_authors ba ON ba.book_id = bs.book_id AND ba.role = 'author'
  JOIN authors a ON a.id = ba.author_id
  WHERE bs.series_id = ?
  GROUP BY a.id
  ORDER BY cnt DESC
`);

const seriesTransaction = db.transaction(() => {
  let count = 0;
  for (const s of allSeries) {
    const authorCounts = getSeriesAuthorCounts.all(s.id) as { name: string; cnt: number }[];

    let authorName: string | undefined;
    if (authorCounts.length === 1) {
      // Single author — use their name
      authorName = authorCounts[0].name;
    } else if (authorCounts.length > 1) {
      // Check if one author dominates (appears in > 50% of books)
      const totalBooks = authorCounts.reduce((sum, a) => sum + a.cnt, 0);
      const topAuthor = authorCounts[0];
      if (topAuthor.cnt > totalBooks / 2) {
        authorName = topAuthor.name;
      }
      // Multiple authors with no clear majority: omit author
    }

    let slug = generateSeriesSlug(s.name, authorName);

    // Handle collisions
    let finalSlug = slug;
    let suffix = 2;
    while (seriesSlugSet.has(finalSlug)) {
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }
    seriesSlugSet.add(finalSlug);
    updateSeriesSlug.run(finalSlug, s.id);
    count++;
  }
  return count;
});

const seriesCount = seriesTransaction();
console.log(`  Updated ${seriesCount} series slugs`);

// ─── Step 5: Add unique indexes ───

console.log("\nAdding unique indexes...");

try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS books_slug_unique ON books(slug)");
  console.log("  Created books_slug_unique index");
} catch (e: any) {
  console.log("  books_slug_unique:", e.message);
}

try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS authors_slug_unique ON authors(slug)");
  console.log("  Created authors_slug_unique index");
} catch (e: any) {
  console.log("  authors_slug_unique:", e.message);
}

try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS series_slug_unique ON series(slug)");
  console.log("  Created series_slug_unique index");
} catch (e: any) {
  console.log("  series_slug_unique:", e.message);
}

console.log("\nDone! Slug migration complete.");
db.close();
