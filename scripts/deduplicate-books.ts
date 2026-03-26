/**
 * Deduplicate books in the database.
 *
 * Strategy:
 * 1. Group books by normalized title + author
 * 2. For each group, pick the "best" entry (most metadata, cover, OL key, user data)
 * 3. Merge all user data (ratings, reviews, state, editions, etc.) onto the keeper
 * 4. Reassign series memberships
 * 5. Delete the duplicates
 *
 * Run: npx tsx scripts/deduplicate-books.ts [--dry-run]
 */

require("dotenv").config({ path: ".env.local" });

const Database = require("better-sqlite3");
const db = new Database("data/tbra.db");

const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) console.log("=== DRY RUN — no changes will be made ===\n");

// All tables that reference book_id
const BOOK_REF_TABLES = [
  "user_book_state",
  "user_book_ratings",
  "user_book_reviews",
  "user_owned_editions",
  "user_book_dimension_ratings",
  "review_descriptor_tags",
  "reading_sessions",
  "reading_notes",
  "up_next",
  "user_favorite_books",
  "book_genres",
  "book_authors",
  "book_narrators",
  "book_category_ratings",
  "book_series",
  "enrichment_log",
  "reported_issues",
  "citations",
  "links",
];

// Tables where we should merge (move user data to keeper) vs just delete
const MERGE_TABLES = [
  "user_book_state",
  "user_book_ratings",
  "user_book_reviews",
  "user_owned_editions",
  "user_book_dimension_ratings",
  "review_descriptor_tags",
  "reading_sessions",
  "reading_notes",
  "up_next",
  "user_favorite_books",
];

// Tables where we merge by deduplicating (keep unique values on keeper)
const DEDUP_MERGE_TABLES = [
  "book_genres",
  "book_authors",
  "book_narrators",
  "book_category_ratings",
  "book_series",
];

interface BookRow {
  id: string;
  title: string;
  summary: string | null;
  description: string | null;
  publication_year: number | null;
  pages: number | null;
  audio_length_minutes: number | null;
  cover_image_url: string | null;
  cover_verified: number;
  open_library_key: string | null;
  language: string | null;
  is_fiction: number | null;
  series_cover_url: string | null;
}

/**
 * Score a book entry — higher is better.
 * Prioritizes: user data > cover > metadata completeness > OL key quality
 */
function scoreBook(book: BookRow): number {
  let score = 0;

  // User data references (most important — don't lose user activity)
  for (const table of MERGE_TABLES) {
    try {
      const cnt = db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE book_id = ?`).get(book.id) as { c: number };
      score += cnt.c * 100;
    } catch { }
  }

  // Cover
  if (book.cover_image_url) score += 50;
  if (book.cover_verified) score += 20;

  // Metadata completeness
  if (book.summary) score += 15;
  if (book.description) score += 10;
  if (book.publication_year) score += 8;
  if (book.pages) score += 8;
  if (book.audio_length_minutes) score += 5;
  if (book.open_library_key) score += 10;
  if (book.is_fiction !== null) score += 3;

  // Series membership
  try {
    const seriesCount = db.prepare("SELECT COUNT(*) as c FROM book_series WHERE book_id = ?").get(book.id) as { c: number };
    score += seriesCount.c * 30;
  } catch { }

  // Category ratings (enrichment quality)
  try {
    const catCount = db.prepare("SELECT COUNT(*) as c FROM book_category_ratings WHERE book_id = ?").get(book.id) as { c: number };
    score += catCount.c * 2;
  } catch { }

  return score;
}

/**
 * Merge data from a duplicate book onto the keeper.
 */
function mergeBook(keeperId: string, dupeId: string): void {
  // 1. Merge user-specific tables (move rows, skip conflicts)
  for (const table of MERGE_TABLES) {
    try {
      // Check if table has user_id column for conflict detection
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      const hasUserId = cols.some((c: { name: string }) => c.name === "user_id");

      if (hasUserId) {
        // Get rows from dupe
        const dupeRows = db.prepare(`SELECT * FROM ${table} WHERE book_id = ?`).all(dupeId) as Record<string, unknown>[];
        for (const row of dupeRows) {
          // Check if keeper already has a row for this user
          const existing = db.prepare(`SELECT 1 FROM ${table} WHERE book_id = ? AND user_id = ?`).get(keeperId, row.user_id);
          if (!existing) {
            if (!DRY_RUN) {
              db.prepare(`UPDATE ${table} SET book_id = ? WHERE book_id = ? AND user_id = ?`).run(keeperId, dupeId, row.user_id);
            }
          }
        }
        // Clean up any remaining dupe rows (conflicts that we skipped)
        if (!DRY_RUN) {
          db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(dupeId);
        }
      } else {
        // No user_id — just move all rows
        if (!DRY_RUN) {
          db.prepare(`UPDATE ${table} SET book_id = ? WHERE book_id = ?`).run(keeperId, dupeId);
        }
      }
    } catch { }
  }

  // 2. Merge dedup tables (genres, authors, narrators, series, category ratings)
  for (const table of DEDUP_MERGE_TABLES) {
    try {
      if (table === "book_genres") {
        const keeperGenres = new Set(
          (db.prepare("SELECT genre_id FROM book_genres WHERE book_id = ?").all(keeperId) as { genre_id: string }[]).map((r) => r.genre_id)
        );
        const dupeGenres = db.prepare("SELECT genre_id FROM book_genres WHERE book_id = ?").all(dupeId) as { genre_id: string }[];
        for (const g of dupeGenres) {
          if (!keeperGenres.has(g.genre_id) && !DRY_RUN) {
            try {
              db.prepare("INSERT INTO book_genres (book_id, genre_id) VALUES (?, ?)").run(keeperId, g.genre_id);
            } catch { }
          }
        }
      } else if (table === "book_authors") {
        const keeperAuthors = new Set(
          (db.prepare("SELECT author_id FROM book_authors WHERE book_id = ?").all(keeperId) as { author_id: string }[]).map((r) => r.author_id)
        );
        const dupeAuthors = db.prepare("SELECT author_id, role FROM book_authors WHERE book_id = ?").all(dupeId) as { author_id: string; role: string }[];
        for (const a of dupeAuthors) {
          if (!keeperAuthors.has(a.author_id) && !DRY_RUN) {
            try {
              db.prepare("INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, ?)").run(keeperId, a.author_id, a.role);
            } catch { }
          }
        }
      } else if (table === "book_narrators") {
        const keeperNarrators = new Set(
          (db.prepare("SELECT narrator_id FROM book_narrators WHERE book_id = ?").all(keeperId) as { narrator_id: string }[]).map((r) => r.narrator_id)
        );
        const dupeNarrators = db.prepare("SELECT narrator_id FROM book_narrators WHERE book_id = ?").all(dupeId) as { narrator_id: string }[];
        for (const n of dupeNarrators) {
          if (!keeperNarrators.has(n.narrator_id) && !DRY_RUN) {
            try {
              db.prepare("INSERT INTO book_narrators (book_id, narrator_id) VALUES (?, ?)").run(keeperId, n.narrator_id);
            } catch { }
          }
        }
      } else if (table === "book_series") {
        const keeperSeries = new Set(
          (db.prepare("SELECT series_id FROM book_series WHERE book_id = ?").all(keeperId) as { series_id: string }[]).map((r) => r.series_id)
        );
        const dupeSeries = db.prepare("SELECT series_id, position_in_series FROM book_series WHERE book_id = ?").all(dupeId) as { series_id: string; position_in_series: number | null }[];
        for (const s of dupeSeries) {
          if (!keeperSeries.has(s.series_id) && !DRY_RUN) {
            try {
              db.prepare("INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)").run(keeperId, s.series_id, s.position_in_series);
            } catch { }
          }
        }
      } else if (table === "book_category_ratings") {
        const keeperCats = new Set(
          (db.prepare("SELECT category_id FROM book_category_ratings WHERE book_id = ?").all(keeperId) as { category_id: string }[]).map((r) => r.category_id)
        );
        const dupeCats = db.prepare("SELECT * FROM book_category_ratings WHERE book_id = ?").all(dupeId) as Record<string, unknown>[];
        for (const c of dupeCats) {
          if (!keeperCats.has(c.category_id as string) && !DRY_RUN) {
            try {
              db.prepare("UPDATE book_category_ratings SET book_id = ? WHERE book_id = ? AND category_id = ?").run(keeperId, dupeId, c.category_id);
            } catch { }
          }
        }
      }

      // Delete remaining dupe rows
      if (!DRY_RUN) {
        db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(dupeId);
      }
    } catch { }
  }

  // 3. Copy missing metadata from dupe to keeper
  if (!DRY_RUN) {
    const keeper = db.prepare("SELECT * FROM books WHERE id = ?").get(keeperId) as BookRow;
    const dupe = db.prepare("SELECT * FROM books WHERE id = ?").get(dupeId) as BookRow;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (!keeper.summary && dupe.summary) { updates.push("summary = ?"); values.push(dupe.summary); }
    if (!keeper.description && dupe.description) { updates.push("description = ?"); values.push(dupe.description); }
    if (!keeper.publication_year && dupe.publication_year) { updates.push("publication_year = ?"); values.push(dupe.publication_year); }
    if (!keeper.pages && dupe.pages) { updates.push("pages = ?"); values.push(dupe.pages); }
    if (!keeper.audio_length_minutes && dupe.audio_length_minutes) { updates.push("audio_length_minutes = ?"); values.push(dupe.audio_length_minutes); }
    if (!keeper.cover_image_url && dupe.cover_image_url) { updates.push("cover_image_url = ?"); values.push(dupe.cover_image_url); }
    if (keeper.is_fiction === null && dupe.is_fiction !== null) { updates.push("is_fiction = ?"); values.push(dupe.is_fiction); }

    if (updates.length > 0) {
      values.push(keeperId);
      db.prepare(`UPDATE books SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }
  }

  // 4. Clean up remaining references and delete
  if (!DRY_RUN) {
    for (const table of BOOK_REF_TABLES) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(dupeId);
      } catch { }
    }
    db.prepare("DELETE FROM books WHERE id = ?").run(dupeId);
  }
}

// Main dedup pass
console.log("Finding duplicate groups...\n");

const dupeGroups = db.prepare(`
  SELECT
    LOWER(TRIM(b.title)) as norm_title,
    a.id as author_id,
    a.name as author_name,
    GROUP_CONCAT(b.id, '||') as ids
  FROM books b
  JOIN book_authors ba ON ba.book_id = b.id
  JOIN authors a ON a.id = ba.author_id
  WHERE b.language IS NULL OR b.language = 'English'
  GROUP BY LOWER(TRIM(b.title)), a.id
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
`).all() as { norm_title: string; author_id: string; author_name: string; ids: string }[];

console.log(`Found ${dupeGroups.length} duplicate groups\n`);

let totalMerged = 0;
let totalDeleted = 0;

// Process in a transaction for safety
const processAll = db.transaction(() => {
  for (const group of dupeGroups) {
    const bookIds = group.ids.split("||");
    const books = bookIds.map((id: string) => db.prepare("SELECT * FROM books WHERE id = ?").get(id)).filter(Boolean) as BookRow[];

    if (books.length < 2) continue;

    // Score each book and pick the best
    const scored = books.map((b) => ({ book: b, score: scoreBook(b) }));
    scored.sort((a, b) => b.score - a.score);

    const keeper = scored[0].book;
    const dupes = scored.slice(1).map((s) => s.book);

    // Merge each dupe into keeper
    for (const dupe of dupes) {
      mergeBook(keeper.id, dupe.id);
      totalDeleted++;
    }
    totalMerged++;

    if (totalMerged % 100 === 0) {
      console.log(`  Processed ${totalMerged} groups, ${totalDeleted} duplicates removed...`);
    }
  }
});

processAll();

console.log(`\n=== ${DRY_RUN ? "DRY RUN " : ""}COMPLETE ===`);
console.log(`Groups processed: ${totalMerged}`);
console.log(`Duplicate entries ${DRY_RUN ? "would be " : ""}removed: ${totalDeleted}`);
console.log(`Remaining books: ${(db.prepare("SELECT COUNT(*) as c FROM books").get() as { c: number }).c}`);
