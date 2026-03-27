/**
 * Comprehensive book deduplication script.
 *
 * Finds duplicate books (same normalized title + same author), picks the
 * best canonical entry, merges all user data onto it, then deletes the dupes.
 *
 * Usage:
 *   npx tsx scripts/dedup-books.ts --dry-run   # preview only
 *   npx tsx scripts/dedup-books.ts              # execute merges
 */

import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const client = createClient({ url: "file:data/tbra.db" });

const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a title for dedup grouping. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")            // strip trailing parenthetical "(Series, #N)"
    .replace(/\s*:\s+a\s+novel\s*$/i, "")        // strip ": A Novel"
    .replace(/\s*:\s+a\s+memoir\s*$/i, "")        // strip ": A Memoir"
    .replace(/,?\s*a\s+novel\s*$/i, "")           // strip ", A Novel" or " A Novel"
    .replace(/^the\s+/i, "")                       // strip leading "The "
    .replace(/^a\s+/i, "")                         // strip leading "A "
    .replace(/[^a-z0-9]/g, "")                     // only alphanumeric
    .trim();
}

// NOTE: We intentionally do NOT strip "#N", "Book N", or issue numbers
// from titles, because those distinguish different books in a series
// (e.g., "Briar #1" vs "Briar #2" are different comics).
// Only parenthetical series info like "(Red Rising Saga, #1)" is stripped.

/** Normalize an author name for grouping. */
function normalizeAuthor(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

const STATE_PRIORITY: Record<string, number> = {
  completed: 3,
  currently_reading: 2,
  tbr: 1,
  dnf: 0,
};

function statePriority(state: string | null): number {
  if (!state) return -1;
  return STATE_PRIORITY[state] ?? 0;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookInfo {
  id: string;
  title: string;
  cover_image_url: string | null;
  cover_verified: number;
  summary: string | null;
  description: string | null;
  slug: string | null;
  pages: number | null;
  words: number | null;
  audio_length_minutes: number | null;
  open_library_key: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
  asin: string | null;
  publication_year: number | null;
  publication_date: string | null;
  language: string | null;
  publisher: string | null;
  is_fiction: number | null;
  is_box_set: number;
  pacing: string | null;
  series_cover_url: string | null;
  cover_source: string | null;
  visibility: string;
}

interface DupeGroup {
  normTitle: string;
  authorName: string;
  books: BookInfo[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

async function scoreBook(book: BookInfo): Promise<number> {
  let score = 0;

  // Cover image (+10)
  if (book.cover_image_url) score += 10;

  // Cover verified (+5)
  if (book.cover_verified) score += 5;

  // Has content ratings (+10)
  const ratingCount = await client.execute({
    sql: "SELECT COUNT(*) as c FROM book_category_ratings WHERE book_id = ?",
    args: [book.id],
  });
  if ((ratingCount.rows[0].c as number) > 0) score += 10;

  // Has summary (+5)
  if (book.summary) score += 5;

  // Has slug (+3)
  if (book.slug) score += 3;

  // Has more pages data (+2)
  if (book.pages) score += 2;

  // Shorter/cleaner title (+3, penalize parentheticals)
  if (!book.title.includes("(")) score += 3;

  // Has OpenLibrary key (+2)
  if (book.open_library_key) score += 2;

  // Has description (+1)
  if (book.description) score += 1;

  // Has ISBN (+1)
  if (book.isbn_13 || book.isbn_10) score += 1;

  // Has user data — big tiebreaker to avoid losing user state
  const userDataCount = await client.execute({
    sql: "SELECT COUNT(*) as c FROM user_book_state WHERE book_id = ?",
    args: [book.id],
  });
  score += (userDataCount.rows[0].c as number) * 20;

  return score;
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

async function mergeUserBookState(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;

  const dupeStates = await client.execute({
    sql: "SELECT user_id, state, owned_formats, active_formats, updated_at FROM user_book_state WHERE book_id = ?",
    args: [dupeId],
  });

  for (const row of dupeStates.rows) {
    const userId = row.user_id as string;
    const dupeState = row.state as string | null;

    const canonical = await client.execute({
      sql: "SELECT state FROM user_book_state WHERE book_id = ? AND user_id = ?",
      args: [canonicalId, userId],
    });

    if (canonical.rows.length === 0) {
      // User only has dupe — move to canonical
      if (!DRY_RUN) {
        await client.execute({
          sql: "UPDATE user_book_state SET book_id = ? WHERE book_id = ? AND user_id = ?",
          args: [canonicalId, dupeId, userId],
        });
      }
      moved++;
    } else {
      // User has both — keep more-progressed state
      const canonicalState = canonical.rows[0].state as string | null;
      if (statePriority(dupeState) > statePriority(canonicalState)) {
        if (!DRY_RUN) {
          await client.execute({
            sql: "UPDATE user_book_state SET state = ? WHERE book_id = ? AND user_id = ?",
            args: [dupeState, canonicalId, userId],
          });
        }
      }
      // Delete the dupe row
      if (!DRY_RUN) {
        await client.execute({
          sql: "DELETE FROM user_book_state WHERE book_id = ? AND user_id = ?",
          args: [dupeId, userId],
        });
      }
      moved++;
    }
  }

  return moved;
}

async function mergeUserBookRatings(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;
  const dupeRows = await client.execute({
    sql: "SELECT user_id FROM user_book_ratings WHERE book_id = ?",
    args: [dupeId],
  });

  for (const row of dupeRows.rows) {
    const userId = row.user_id as string;
    const existing = await client.execute({
      sql: "SELECT 1 FROM user_book_ratings WHERE book_id = ? AND user_id = ?",
      args: [canonicalId, userId],
    });
    if (existing.rows.length === 0) {
      if (!DRY_RUN) {
        await client.execute({
          sql: "UPDATE user_book_ratings SET book_id = ? WHERE book_id = ? AND user_id = ?",
          args: [canonicalId, dupeId, userId],
        });
      }
      moved++;
    } else {
      if (!DRY_RUN) {
        await client.execute({
          sql: "DELETE FROM user_book_ratings WHERE book_id = ? AND user_id = ?",
          args: [dupeId, userId],
        });
      }
    }
  }

  return moved;
}

async function mergeUserBookReviews(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;
  const dupeRows = await client.execute({
    sql: "SELECT id, user_id FROM user_book_reviews WHERE book_id = ?",
    args: [dupeId],
  });

  for (const row of dupeRows.rows) {
    const userId = row.user_id as string;
    const dupeReviewId = row.id as string;

    const existing = await client.execute({
      sql: "SELECT id FROM user_book_reviews WHERE book_id = ? AND user_id = ?",
      args: [canonicalId, userId],
    });

    if (existing.rows.length === 0) {
      if (!DRY_RUN) {
        await client.execute({
          sql: "UPDATE user_book_reviews SET book_id = ? WHERE book_id = ? AND user_id = ?",
          args: [canonicalId, dupeId, userId],
        });
      }
      moved++;
    } else {
      // Delete dupe review and its dimension ratings + descriptor tags
      if (!DRY_RUN) {
        await client.execute({
          sql: "DELETE FROM user_book_dimension_ratings WHERE review_id = ?",
          args: [dupeReviewId],
        });
        await client.execute({
          sql: "DELETE FROM review_descriptor_tags WHERE review_id = ?",
          args: [dupeReviewId],
        });
        await client.execute({
          sql: "DELETE FROM user_book_reviews WHERE id = ?",
          args: [dupeReviewId],
        });
      }
    }
  }

  return moved;
}

async function mergeUserFavorites(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;
  const dupeRows = await client.execute({
    sql: "SELECT user_id, position FROM user_favorite_books WHERE book_id = ?",
    args: [dupeId],
  });

  for (const row of dupeRows.rows) {
    const userId = row.user_id as string;
    const existing = await client.execute({
      sql: "SELECT 1 FROM user_favorite_books WHERE book_id = ? AND user_id = ?",
      args: [canonicalId, userId],
    });
    if (existing.rows.length === 0) {
      if (!DRY_RUN) {
        await client.execute({
          sql: "UPDATE user_favorite_books SET book_id = ? WHERE book_id = ? AND user_id = ?",
          args: [canonicalId, dupeId, userId],
        });
      }
      moved++;
    } else {
      if (!DRY_RUN) {
        await client.execute({
          sql: "DELETE FROM user_favorite_books WHERE book_id = ? AND user_id = ?",
          args: [dupeId, userId],
        });
      }
    }
  }

  return moved;
}

async function mergeReadingSessions(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;
  const dupeRows = await client.execute({
    sql: "SELECT id, user_id, read_number FROM reading_sessions WHERE book_id = ?",
    args: [dupeId],
  });

  for (const row of dupeRows.rows) {
    const userId = row.user_id as string;
    const readNumber = row.read_number as number;
    const sessionId = row.id as string;

    // Check if canonical already has this user+read_number combo
    const existing = await client.execute({
      sql: "SELECT 1 FROM reading_sessions WHERE book_id = ? AND user_id = ? AND read_number = ?",
      args: [canonicalId, userId, readNumber],
    });
    if (existing.rows.length === 0) {
      if (!DRY_RUN) {
        await client.execute({
          sql: "UPDATE reading_sessions SET book_id = ? WHERE id = ?",
          args: [canonicalId, sessionId],
        });
      }
      moved++;
    } else {
      if (!DRY_RUN) {
        await client.execute({
          sql: "DELETE FROM reading_sessions WHERE id = ?",
          args: [sessionId],
        });
      }
    }
  }

  return moved;
}

async function mergeReadingNotes(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;
  const dupeRows = await client.execute({
    sql: "SELECT id FROM reading_notes WHERE book_id = ?",
    args: [dupeId],
  });

  if (dupeRows.rows.length > 0 && !DRY_RUN) {
    await client.execute({
      sql: "UPDATE reading_notes SET book_id = ? WHERE book_id = ?",
      args: [canonicalId, dupeId],
    });
  }
  moved += dupeRows.rows.length;

  return moved;
}

async function mergeUpNext(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;
  const dupeRows = await client.execute({
    sql: "SELECT user_id FROM up_next WHERE book_id = ?",
    args: [dupeId],
  });

  for (const row of dupeRows.rows) {
    const userId = row.user_id as string;
    const existing = await client.execute({
      sql: "SELECT 1 FROM up_next WHERE book_id = ? AND user_id = ?",
      args: [canonicalId, userId],
    });
    if (existing.rows.length === 0) {
      if (!DRY_RUN) {
        await client.execute({
          sql: "UPDATE up_next SET book_id = ? WHERE book_id = ? AND user_id = ?",
          args: [canonicalId, dupeId, userId],
        });
      }
      moved++;
    } else {
      if (!DRY_RUN) {
        await client.execute({
          sql: "DELETE FROM up_next WHERE book_id = ? AND user_id = ?",
          args: [dupeId, userId],
        });
      }
    }
  }

  return moved;
}

async function mergeUserHiddenBooks(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;
  const dupeRows = await client.execute({
    sql: "SELECT user_id FROM user_hidden_books WHERE book_id = ?",
    args: [dupeId],
  });

  for (const row of dupeRows.rows) {
    const userId = row.user_id as string;
    const existing = await client.execute({
      sql: "SELECT 1 FROM user_hidden_books WHERE book_id = ? AND user_id = ?",
      args: [canonicalId, userId],
    });
    if (existing.rows.length === 0) {
      if (!DRY_RUN) {
        await client.execute({
          sql: "UPDATE user_hidden_books SET book_id = ? WHERE book_id = ? AND user_id = ?",
          args: [canonicalId, dupeId, userId],
        });
      }
      moved++;
    } else {
      if (!DRY_RUN) {
        await client.execute({
          sql: "DELETE FROM user_hidden_books WHERE book_id = ? AND user_id = ?",
          args: [dupeId, userId],
        });
      }
    }
  }

  return moved;
}

async function mergeUserOwnedEditions(canonicalId: string, dupeId: string): Promise<number> {
  let moved = 0;
  const dupeRows = await client.execute({
    sql: "SELECT user_id, edition_id, format FROM user_owned_editions WHERE book_id = ?",
    args: [dupeId],
  });

  for (const row of dupeRows.rows) {
    const userId = row.user_id as string;
    const editionId = row.edition_id as string;
    const format = row.format as string;

    const existing = await client.execute({
      sql: "SELECT 1 FROM user_owned_editions WHERE book_id = ? AND user_id = ? AND edition_id = ? AND format = ?",
      args: [canonicalId, userId, editionId, format],
    });
    if (existing.rows.length === 0) {
      if (!DRY_RUN) {
        await client.execute({
          sql: "UPDATE user_owned_editions SET book_id = ? WHERE book_id = ? AND user_id = ? AND edition_id = ? AND format = ?",
          args: [canonicalId, dupeId, userId, editionId, format],
        });
      }
      moved++;
    } else {
      if (!DRY_RUN) {
        await client.execute({
          sql: "DELETE FROM user_owned_editions WHERE book_id = ? AND user_id = ? AND edition_id = ? AND format = ?",
          args: [dupeId, userId, editionId, format],
        });
      }
    }
  }

  return moved;
}

/** Copy missing metadata fields from dupe onto canonical. */
async function copyMissingMetadata(canonicalId: string, dupe: BookInfo): Promise<void> {
  if (DRY_RUN) return;

  const canonicalRes = await client.execute({
    sql: "SELECT * FROM books WHERE id = ?",
    args: [canonicalId],
  });
  if (canonicalRes.rows.length === 0) return;
  const c = canonicalRes.rows[0];

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  const fields: [string, keyof BookInfo][] = [
    ["summary", "summary"],
    ["description", "description"],
    ["publication_year", "publication_year"],
    ["publication_date", "publication_date"],
    ["pages", "pages"],
    ["words", "words"],
    ["audio_length_minutes", "audio_length_minutes"],
    ["cover_image_url", "cover_image_url"],
    ["isbn_13", "isbn_13"],
    ["isbn_10", "isbn_10"],
    ["asin", "asin"],
    ["language", "language"],
    ["publisher", "publisher"],
    ["pacing", "pacing"],
    ["series_cover_url", "series_cover_url"],
    ["cover_source", "cover_source"],
  ];

  for (const [col, key] of fields) {
    if (!c[col] && dupe[key]) {
      updates.push(`${col} = ?`);
      values.push(dupe[key] as string | number | null);
    }
  }

  // Special: copy is_fiction only if canonical is null
  if (c.is_fiction === null && dupe.is_fiction !== null) {
    updates.push("is_fiction = ?");
    values.push(dupe.is_fiction);
  }

  // Special: prefer verified cover
  if (dupe.cover_verified && !c.cover_verified && dupe.cover_image_url) {
    updates.push("cover_image_url = ?", "cover_verified = 1");
    values.push(dupe.cover_image_url);
    if (dupe.cover_source) {
      updates.push("cover_source = ?");
      values.push(dupe.cover_source);
    }
  }

  if (updates.length > 0) {
    values.push(canonicalId);
    try {
      await client.execute({
        sql: `UPDATE books SET ${updates.join(", ")} WHERE id = ?`,
        args: values,
      });
    } catch (e: unknown) {
      // If UNIQUE constraint fails (e.g., ISBN conflict), retry without ISBN fields
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint")) {
        const safeUpdates: string[] = [];
        const safeValues: (string | number | null)[] = [];
        for (let i = 0; i < updates.length; i++) {
          if (!updates[i].startsWith("isbn_") && !updates[i].startsWith("asin")) {
            safeUpdates.push(updates[i]);
            safeValues.push(values[i]);
          }
        }
        if (safeUpdates.length > 0) {
          safeValues.push(canonicalId);
          await client.execute({
            sql: `UPDATE books SET ${safeUpdates.join(", ")} WHERE id = ?`,
            args: safeValues,
          });
        }
      }
    }
  }
}

/** Delete all remaining references to a dupe book and the book itself. */
async function deleteDupeBook(dupeId: string): Promise<void> {
  if (DRY_RUN) return;

  const refTables = [
    "book_authors",
    "book_genres",
    "book_series",
    "book_narrators",
    "book_category_ratings",
    "enrichment_log",
    "links",
    "reported_issues",
    "editions",
    "landing_page_books",
    "user_hidden_books",
    "user_owned_editions",
    "up_next",
    "user_favorite_books",
    "reading_notes",
    "reading_sessions",
    "user_book_ratings",
    "user_book_state",
  ];

  // Delete rating_citations for this book's category ratings
  const catRatings = await client.execute({
    sql: "SELECT id FROM book_category_ratings WHERE book_id = ?",
    args: [dupeId],
  });
  for (const r of catRatings.rows) {
    await client.execute({
      sql: "DELETE FROM rating_citations WHERE rating_id = ?",
      args: [r.id as string],
    });
  }

  // Delete reviews + their dimension ratings + descriptor tags
  const reviews = await client.execute({
    sql: "SELECT id FROM user_book_reviews WHERE book_id = ?",
    args: [dupeId],
  });
  for (const r of reviews.rows) {
    await client.execute({
      sql: "DELETE FROM user_book_dimension_ratings WHERE review_id = ?",
      args: [r.id as string],
    });
    await client.execute({
      sql: "DELETE FROM review_descriptor_tags WHERE review_id = ?",
      args: [r.id as string],
    });
  }
  await client.execute({
    sql: "DELETE FROM user_book_reviews WHERE book_id = ?",
    args: [dupeId],
  });

  for (const table of refTables) {
    try {
      await client.execute({
        sql: `DELETE FROM ${table} WHERE book_id = ?`,
        args: [dupeId],
      });
    } catch {
      // Table might not have book_id column in some edge case — skip
    }
  }

  await client.execute({
    sql: "DELETE FROM books WHERE id = ?",
    args: [dupeId],
  });
}

/** Merge book_genres, book_authors, book_narrators, book_series from dupe onto canonical. */
async function mergeBookMetadataLinks(canonicalId: string, dupeId: string): Promise<void> {
  if (DRY_RUN) return;

  // Genres
  const dupeGenres = await client.execute({
    sql: "SELECT genre_id FROM book_genres WHERE book_id = ?",
    args: [dupeId],
  });
  const keeperGenres = new Set(
    (await client.execute({ sql: "SELECT genre_id FROM book_genres WHERE book_id = ?", args: [canonicalId] }))
      .rows.map(r => r.genre_id as string)
  );
  for (const g of dupeGenres.rows) {
    if (!keeperGenres.has(g.genre_id as string)) {
      try {
        await client.execute({
          sql: "INSERT INTO book_genres (book_id, genre_id) VALUES (?, ?)",
          args: [canonicalId, g.genre_id as string],
        });
      } catch { /* ignore constraint violations */ }
    }
  }

  // Authors
  const dupeAuthors = await client.execute({
    sql: "SELECT author_id, role FROM book_authors WHERE book_id = ?",
    args: [dupeId],
  });
  const keeperAuthors = new Set(
    (await client.execute({ sql: "SELECT author_id FROM book_authors WHERE book_id = ?", args: [canonicalId] }))
      .rows.map(r => r.author_id as string)
  );
  for (const a of dupeAuthors.rows) {
    if (!keeperAuthors.has(a.author_id as string)) {
      try {
        await client.execute({
          sql: "INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, ?)",
          args: [canonicalId, a.author_id as string, a.role as string],
        });
      } catch { /* ignore */ }
    }
  }

  // Narrators
  const dupeNarrators = await client.execute({
    sql: "SELECT narrator_id FROM book_narrators WHERE book_id = ?",
    args: [dupeId],
  });
  const keeperNarrators = new Set(
    (await client.execute({ sql: "SELECT narrator_id FROM book_narrators WHERE book_id = ?", args: [canonicalId] }))
      .rows.map(r => r.narrator_id as string)
  );
  for (const n of dupeNarrators.rows) {
    if (!keeperNarrators.has(n.narrator_id as string)) {
      try {
        await client.execute({
          sql: "INSERT INTO book_narrators (book_id, narrator_id) VALUES (?, ?)",
          args: [canonicalId, n.narrator_id as string],
        });
      } catch { /* ignore */ }
    }
  }

  // Series
  const dupeSeries = await client.execute({
    sql: "SELECT series_id, position_in_series FROM book_series WHERE book_id = ?",
    args: [dupeId],
  });
  const keeperSeries = new Set(
    (await client.execute({ sql: "SELECT series_id FROM book_series WHERE book_id = ?", args: [canonicalId] }))
      .rows.map(r => r.series_id as string)
  );
  for (const s of dupeSeries.rows) {
    if (!keeperSeries.has(s.series_id as string)) {
      try {
        await client.execute({
          sql: "INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)",
          args: [canonicalId, s.series_id as string, s.position_in_series as number | null],
        });
      } catch { /* ignore */ }
    }
  }

  // Category ratings — move unique category_id entries
  const dupeCatRatings = await client.execute({
    sql: "SELECT id, category_id FROM book_category_ratings WHERE book_id = ?",
    args: [dupeId],
  });
  const keeperCats = new Set(
    (await client.execute({ sql: "SELECT category_id FROM book_category_ratings WHERE book_id = ?", args: [canonicalId] }))
      .rows.map(r => r.category_id as string)
  );
  for (const c of dupeCatRatings.rows) {
    if (!keeperCats.has(c.category_id as string)) {
      try {
        await client.execute({
          sql: "UPDATE book_category_ratings SET book_id = ? WHERE id = ?",
          args: [canonicalId, c.id as string],
        });
      } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(DRY_RUN ? "  DRY RUN — no changes will be made" : "  LIVE RUN — changes will be committed");
  console.log(`${"=".repeat(60)}\n`);

  // Disable foreign key checks for the duration
  await client.execute("PRAGMA foreign_keys = OFF");

  // 1. Load all books with their primary author
  console.log("Loading all books...");
  const allBooks = await client.execute(`
    SELECT b.*, a.name as author_name
    FROM books b
    LEFT JOIN book_authors ba ON b.id = ba.book_id
    LEFT JOIN authors a ON ba.author_id = a.id
  `);

  console.log(`  Loaded ${allBooks.rows.length} book-author rows`);

  // 2. Group by normalized title + normalized author
  const groups = new Map<string, { authorName: string; books: BookInfo[] }>();

  for (const row of allBooks.rows) {
    const title = row.title as string;
    const authorName = row.author_name as string | null;
    if (!authorName) continue; // skip books with no author — can't reliably dedup

    const normTitle = normalizeTitle(title);
    const normAuthor = normalizeAuthor(authorName);
    if (!normTitle) continue;

    const key = `${normTitle}|||${normAuthor}`;

    if (!groups.has(key)) {
      groups.set(key, { authorName, books: [] });
    }

    const group = groups.get(key)!;
    // Avoid adding the same book ID twice (from multiple author joins)
    if (!group.books.some(b => b.id === row.id)) {
      group.books.push({
        id: row.id as string,
        title: row.title as string,
        cover_image_url: row.cover_image_url as string | null,
        cover_verified: row.cover_verified as number,
        summary: row.summary as string | null,
        description: row.description as string | null,
        slug: row.slug as string | null,
        pages: row.pages as number | null,
        words: row.words as number | null,
        audio_length_minutes: row.audio_length_minutes as number | null,
        open_library_key: row.open_library_key as string | null,
        isbn_13: row.isbn_13 as string | null,
        isbn_10: row.isbn_10 as string | null,
        asin: row.asin as string | null,
        publication_year: row.publication_year as number | null,
        publication_date: row.publication_date as string | null,
        language: row.language as string | null,
        publisher: row.publisher as string | null,
        is_fiction: row.is_fiction as number | null,
        is_box_set: row.is_box_set as number,
        pacing: row.pacing as string | null,
        series_cover_url: row.series_cover_url as string | null,
        cover_source: row.cover_source as string | null,
        visibility: row.visibility as string,
      });
    }
  }

  // Filter to only groups with 2+ books (actual duplicates)
  const dupeGroups: DupeGroup[] = [];
  for (const [key, group] of groups) {
    if (group.books.length >= 2) {
      const [normTitle] = key.split("|||");
      dupeGroups.push({
        normTitle,
        authorName: group.authorName,
        books: group.books,
      });
    }
  }

  console.log(`\nFound ${dupeGroups.length} duplicate groups\n`);

  if (dupeGroups.length === 0) {
    console.log("No duplicates found. Exiting.");
    return;
  }

  // 3. Process each group
  let totalGroupsMerged = 0;
  let totalDupesDeleted = 0;
  let totalUserRecordsMigrated = 0;
  const mergeLog: string[] = [];

  for (const group of dupeGroups) {
    // Score each book in the group
    const scored: { book: BookInfo; score: number }[] = [];
    for (const book of group.books) {
      scored.push({ book, score: await scoreBook(book) });
    }
    scored.sort((a, b) => b.score - a.score);

    const canonical = scored[0].book;
    const dupes = scored.slice(1).map(s => s.book);

    for (const dupe of dupes) {
      let userMoved = 0;

      // Merge all user data
      userMoved += await mergeUserBookState(canonical.id, dupe.id);
      userMoved += await mergeUserBookRatings(canonical.id, dupe.id);
      userMoved += await mergeUserBookReviews(canonical.id, dupe.id);
      userMoved += await mergeUserFavorites(canonical.id, dupe.id);
      userMoved += await mergeReadingSessions(canonical.id, dupe.id);
      userMoved += await mergeReadingNotes(canonical.id, dupe.id);
      userMoved += await mergeUpNext(canonical.id, dupe.id);
      userMoved += await mergeUserHiddenBooks(canonical.id, dupe.id);
      userMoved += await mergeUserOwnedEditions(canonical.id, dupe.id);

      totalUserRecordsMigrated += userMoved;

      // Copy missing metadata from dupe to canonical
      await copyMissingMetadata(canonical.id, dupe);

      // Merge book metadata links (genres, authors, narrators, series, category ratings)
      await mergeBookMetadataLinks(canonical.id, dupe.id);

      // Safety: verify no remaining user data references
      const remainingUserData = await client.execute({
        sql: `SELECT
          (SELECT COUNT(*) FROM user_book_state WHERE book_id = ?) +
          (SELECT COUNT(*) FROM user_book_ratings WHERE book_id = ?) +
          (SELECT COUNT(*) FROM user_book_reviews WHERE book_id = ?) +
          (SELECT COUNT(*) FROM reading_sessions WHERE book_id = ?) +
          (SELECT COUNT(*) FROM reading_notes WHERE book_id = ?) +
          (SELECT COUNT(*) FROM user_favorite_books WHERE book_id = ?) +
          (SELECT COUNT(*) FROM up_next WHERE book_id = ?) as total`,
        args: [dupe.id, dupe.id, dupe.id, dupe.id, dupe.id, dupe.id, dupe.id],
      });

      const remaining = remainingUserData.rows[0].total as number;
      if (remaining > 0 && !DRY_RUN) {
        console.warn(`  WARNING: ${remaining} user records still reference dupe ${dupe.id} "${dupe.title}" — skipping delete`);
        continue;
      }

      // Delete the dupe book and all its remaining references
      await deleteDupeBook(dupe.id);

      const logMsg = `Merged '${dupe.title}' (${dupe.id.slice(0, 8)}) into '${canonical.title}' (${canonical.id.slice(0, 8)})${userMoved > 0 ? ` [${userMoved} user records moved]` : ""}`;
      mergeLog.push(logMsg);
      totalDupesDeleted++;
    }

    totalGroupsMerged++;
  }

  // 4. Summary
  console.log("\n" + "=".repeat(60));
  console.log(`  ${DRY_RUN ? "DRY RUN " : ""}SUMMARY`);
  console.log("=".repeat(60));
  console.log(`  Duplicate groups merged: ${totalGroupsMerged}`);
  console.log(`  Duplicate books ${DRY_RUN ? "to be " : ""}deleted: ${totalDupesDeleted}`);
  console.log(`  User records ${DRY_RUN ? "to be " : ""}migrated: ${totalUserRecordsMigrated}`);

  const remainingBooks = await client.execute("SELECT COUNT(*) as c FROM books");
  console.log(`  Books ${DRY_RUN ? "that would remain" : "remaining"}: ${remainingBooks.rows[0].c}`);

  // Print merge log
  if (mergeLog.length > 0) {
    console.log(`\n--- Merge log (${mergeLog.length} entries) ---\n`);
    for (const msg of mergeLog) {
      console.log(`  ${msg}`);
    }
  }

  // Re-enable foreign keys
  await client.execute("PRAGMA foreign_keys = ON");

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
