import { db } from "@/db";
import {
  books,
  bookAuthors,
  userBookState,
  userBookRatings,
  readingSessions,
  userBookReviews,
  series as seriesTable,
  bookSeries,
  userFavoriteBooks,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { searchOpenLibrary, type OLSearchResult } from "@/lib/openlibrary";
import { importFromOpenLibraryAndReturn, findOrCreateAuthor } from "@/lib/actions/books";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import crypto from "crypto";
import type { GoodreadsRow } from "./parse-goodreads";
import { mergeOwnedFormats, isStateProgression, formatImportError, type ImportOptions, DEFAULT_IMPORT_OPTIONS } from "./import-options";

export interface ImportProgress {
  type: "progress";
  current: number;
  total: number;
  title: string;
  status: "imported" | "existing" | "skipped" | "error";
  error?: string;
}

export interface ImportDone {
  type: "done";
  imported: number;
  existing: number;
  skipped: number;
  errors: { title: string; error: string }[];
}

export type ImportEvent = ImportProgress | ImportDone;

const OL_DELAY_MS = 300;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize a title for fuzzy matching.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:;–—]\s*.+$/, "") // remove subtitle
    .replace(/^(the|a|an)\s+/i, "") // remove leading article
    .replace(/[^a-z0-9\s]/g, "") // remove punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if an OL search result is a reasonable match for the imported row.
 */
function isGoodMatch(result: OLSearchResult, row: GoodreadsRow): boolean {
  const normResult = normalizeTitle(result.title);
  const normRow = normalizeTitle(row.title);

  if (normResult === normRow) return true;

  if (normResult.includes(normRow) && normResult.length <= normRow.length * 1.5) return true;
  if (normRow.includes(normResult) && normRow.length <= normResult.length * 1.5) return true;

  const resultWords = normResult.split(" ");
  const rowWords = normRow.split(" ");
  const resultSet = new Set(resultWords);
  const rowSet = new Set(rowWords);
  const matchesFromRow = rowWords.filter((w) => resultSet.has(w)).length;
  const matchesFromResult = resultWords.filter((w) => rowSet.has(w)).length;

  if (
    rowWords.length > 0 &&
    resultWords.length > 0 &&
    matchesFromRow / rowWords.length >= 0.6 &&
    matchesFromResult / resultWords.length >= 0.6
  ) {
    return true;
  }

  return false;
}

/**
 * Try to find a book already in the DB by title + author (case-insensitive),
 * or by ISBN if provided.
 */
async function findExistingBook(
  title: string,
  authorName: string | null,
  isbn13?: string | null,
  isbn10?: string | null
): Promise<string | null> {
  // 1. Try ISBN lookup first (most reliable)
  if (isbn13) {
    const match = await db.all(sql`
      SELECT id FROM books WHERE isbn_13 = ${isbn13} LIMIT 1
    `) as { id: string }[];
    if (match[0]) return match[0].id;
  }
  if (isbn10) {
    const match = await db.all(sql`
      SELECT id FROM books WHERE isbn_10 = ${isbn10} LIMIT 1
    `) as { id: string }[];
    if (match[0]) return match[0].id;
  }

  // 2. Fallback to title + author
  const matches = await db.all(sql`
    SELECT b.id, b.title
    FROM books b
    LEFT JOIN book_authors ba ON b.id = ba.book_id
    LEFT JOIN authors a ON ba.author_id = a.id
    WHERE LOWER(b.title) = LOWER(${title})
    ${authorName ? sql`AND LOWER(a.name) = LOWER(${authorName})` : sql``}
    LIMIT 1
  `) as { id: string; title: string }[];

  return matches[0]?.id ?? null;
}

/**
 * Find or create a series by name, return series ID.
 */
async function findOrCreateSeries(name: string): Promise<string> {
  const existing = await db.all(sql`
    SELECT id FROM series WHERE LOWER(name) = LOWER(${name}) LIMIT 1
  `) as { id: string }[];

  if (existing[0]) return existing[0].id;

  const id = crypto.randomUUID();
  await db.insert(seriesTable).values({ id, name });
  return id;
}

/**
 * Link a book to a series at a given position (idempotent).
 */
async function linkBookToSeries(
  bookId: string,
  seriesId: string,
  position: number | null
): Promise<void> {
  // Check if already linked
  const existing = await db.all(sql`
    SELECT book_id FROM book_series
    WHERE book_id = ${bookId} AND series_id = ${seriesId}
    LIMIT 1
  `) as { book_id: string }[];

  if (existing.length > 0) return;

  await db.insert(bookSeries).values({
    bookId,
    seriesId,
    positionInSeries: position ? Math.floor(position) : null,
  });
}

/**
 * Mark a book as owned with format.
 * When cleanUnknown is true, strips all "unknown" entries from existing formats.
 */
async function markOwned(userId: string, bookId: string, format: string | null, cleanUnknown: boolean): Promise<void> {
  const existing = await db
    .select()
    .from(userBookState)
    .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
    .get();

  if (existing) {
    const currentFormats: string[] = existing.ownedFormats
      ? (JSON.parse(existing.ownedFormats) as string[])
      : [];
    let updatedFormats: string[];
    if (cleanUnknown) {
      updatedFormats = mergeOwnedFormats(currentFormats, format);
    } else {
      updatedFormats = [...currentFormats];
      if (format && !updatedFormats.includes(format)) {
        updatedFormats.push(format);
      }
    }
    if (updatedFormats.length === 0) {
      updatedFormats.push("unknown");
    }
    await db
      .update(userBookState)
      .set({
        ownedFormats: JSON.stringify(updatedFormats),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)));
  } else {
    const formats = format ? [format] : ["unknown"];
    await db.insert(userBookState).values({
      userId,
      bookId,
      ownedFormats: JSON.stringify(formats),
    });
  }
}

/**
 * Process a single Goodreads import row.
 */
async function processRow(
  row: GoodreadsRow,
  userId: string,
  options: ImportOptions
): Promise<{ status: "imported" | "existing" | "skipped" | "error"; error?: string; bookId?: string }> {
  try {
    // 1. Check if book already exists in DB (by ISBN first, then title+author)
    let bookId = await findExistingBook(row.title, row.author || null, row.isbn13, row.isbn10);
    let status: "imported" | "existing" = "imported";

    if (bookId) {
      const existingUserState = await db
        .select()
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
        .get();
      status = existingUserState ? "existing" : "imported";
    }

    if (!bookId) {
      let match: OLSearchResult | undefined;

      // 2a. Try ISBN lookup first (most reliable)
      const isbn = row.isbn13 || row.isbn10;
      if (isbn) {
        await delay(OL_DELAY_MS);
        const isbnResults = await searchOpenLibrary(isbn, 5);
        match = isbnResults.find((r) => isGoodMatch(r, row));
        if (!match && isbnResults.length > 0) {
          match = isbnResults[0];
        }
      }

      // 2b. Fallback to title+author text search
      if (!match) {
        const query = row.author
          ? `${row.title} ${row.author}`
          : row.title;

        await delay(OL_DELAY_MS);
        const results = await searchOpenLibrary(query, 5);
        match = results.find((r) => isGoodMatch(r, row));
      }

      if (match) {
        bookId = await importFromOpenLibraryAndReturn(match);
        // Trigger enrichment explicitly — after() in importFromOpenLibraryAndReturn
        // doesn't fire outside of serverless route context
        if (bookId) {
          enrichBook(bookId).catch((err) => {
            console.error(`[goodreads-import] Enrichment error for "${row.title}":`, err);
          });
        }
        status = "imported";
      } else {
        // Create minimal book record
        const [book] = await db
          .insert(books)
          .values({
            title: row.title,
            isbn13: row.isbn13,
            isbn10: row.isbn10,
            pages: row.pages,
            publicationYear: row.originalPublicationYear || row.yearPublished,
          })
          .returning();
        bookId = book.id;

        if (row.author) {
          const authorId = await findOrCreateAuthor(row.author);
          await db.insert(bookAuthors).values({ bookId, authorId }).onConflictDoNothing();
        }

        // Additional authors
        for (const additionalAuthor of row.additionalAuthors) {
          const authorId = await findOrCreateAuthor(additionalAuthor);
          await db.insert(bookAuthors).values({ bookId, authorId }).onConflictDoNothing();
        }

        // Generate SEO slug
        const { assignBookSlug } = await import("@/lib/utils/slugify");
        await assignBookSlug(bookId, row.title, row.author ?? "");

        // Trigger enrichment for unmatched books
        enrichBook(bookId).catch((err) => {
          console.error(`[goodreads-import] Enrichment error for "${row.title}":`, err);
        });

        status = "imported";
      }
    }

    const isExistingBook = status === "existing";

    // 3. Link to series if parsed from title
    if (row.seriesName) {
      const seriesId = await findOrCreateSeries(row.seriesName);
      await linkBookToSeries(bookId, seriesId, row.seriesPosition);
    }

    // 4. Set user reading state
    // Always create user state — if a book is in a Goodreads export, the user tracked it.
    // Default to "tbr" if no explicit status (prevents orphaned books invisible to the user).
    {
      const existingState = await db
        .select()
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
        .get();

      const stateValue = row.readStatus ?? "tbr";

      // Use date read as updatedAt so completed books sort by finish date
      const updatedAt = row.dateRead
        ? `${row.dateRead}T00:00:00.000Z`
        : new Date().toISOString();

      if (existingState) {
        // For existing books: skip if option disabled, or only move forward
        const shouldUpdateState = !isExistingBook || (
          options.updateReadingStates &&
          isStateProgression(existingState.state, stateValue)
        );
        if (shouldUpdateState) {
          await db
            .update(userBookState)
            .set({ state: stateValue ?? existingState.state, updatedAt })
            .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)));
        }
      } else {
        await db.insert(userBookState).values({
          userId,
          bookId,
          state: stateValue,
          updatedAt,
        });
      }

      // Create reading sessions for completed/currently-reading books
      if (row.readStatus === "completed" || row.readStatus === "currently_reading") {
        const dateStr = row.dateRead || new Date().toISOString().slice(0, 10);

        // Handle re-reads: create multiple reading sessions
        const sessionCount = Math.max(1, row.readCount);
        for (let readNum = 1; readNum <= sessionCount; readNum++) {
          const existingSession = await db.all(sql`
            SELECT id FROM reading_sessions
            WHERE user_id = ${userId} AND book_id = ${bookId} AND read_number = ${readNum}
            LIMIT 1
          `) as { id: string }[];

          if (existingSession.length === 0) {
            await db.insert(readingSessions).values({
              id: crypto.randomUUID(),
              userId,
              bookId,
              readNumber: readNum,
              startedAt: dateStr,
              completionDate: row.readStatus === "completed" ? dateStr : null,
              completionPrecision: row.dateRead ? "exact" : null,
              state: row.readStatus,
            });
          }
        }
      }
    }

    // 5. Set rating
    if (row.rating && (!isExistingBook || options.updateRatingsReviews)) {
      const existingRating = await db
        .select()
        .from(userBookRatings)
        .where(and(eq(userBookRatings.userId, userId), eq(userBookRatings.bookId, bookId)))
        .get();

      if (existingRating) {
        await db
          .update(userBookRatings)
          .set({ rating: row.rating, updatedAt: new Date().toISOString() })
          .where(and(eq(userBookRatings.userId, userId), eq(userBookRatings.bookId, bookId)));
      } else {
        await db.insert(userBookRatings).values({
          id: crypto.randomUUID(),
          userId,
          bookId,
          rating: row.rating,
        });
      }
    }

    // 6. Import review
    if (row.rating || row.review) {
      let reviewText: string | null = null;
      if (row.review) {
        // Convert HTML to plain text
        let plainText = row.review
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/?(div|p|em|strong|span|b|i|a)[^>]*>/gi, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim() || null;

        // Wrap spoiler reviews
        if (row.isSpoiler && plainText) {
          plainText = `[SPOILER]\n${plainText}\n[/SPOILER]`;
        }

        reviewText = plainText;
      }

      const existingReview = await db
        .select()
        .from(userBookReviews)
        .where(and(eq(userBookReviews.userId, userId), eq(userBookReviews.bookId, bookId)))
        .get();

      if (!existingReview) {
        // No existing review — create new (always, regardless of options)
        let finishedMonth: number | null = null;
        let finishedYear: number | null = null;
        if (row.dateRead) {
          const parts = row.dateRead.split("-");
          finishedYear = parseInt(parts[0], 10) || null;
          finishedMonth = parseInt(parts[1], 10) || null;
        }

        const reviewCreatedAt = row.dateRead
          ? `${row.dateRead}T12:00:00.000Z`
          : new Date().toISOString();

        await db.insert(userBookReviews).values({
          id: crypto.randomUUID(),
          userId,
          bookId,
          overallRating: row.rating,
          reviewText,
          didNotFinish: false,
          contentComments: "",
          source: "goodreads",
          finishedMonth,
          finishedYear,
          createdAt: reviewCreatedAt,
        });
      } else if (isExistingBook && options.updateRatingsReviews) {
        // Existing review — fill empty review text + update rating
        const updates: Record<string, unknown> = {};
        if (reviewText && !existingReview.reviewText) {
          updates.reviewText = reviewText;
        }
        if (row.rating) {
          updates.overallRating = row.rating;
        }
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date().toISOString();
          await db
            .update(userBookReviews)
            .set(updates)
            .where(and(eq(userBookReviews.userId, userId), eq(userBookReviews.bookId, bookId)));
        }
      }
    }

    // 7. Set owned status
    if (row.ownedCopies > 0 && (!isExistingBook || options.updateOwnedFormats)) {
      await markOwned(userId, bookId, row.format, options.updateOwnedFormats);
    }

    // 8. Set active format for currently reading books
    if (row.format && row.readStatus === "currently_reading") {
      const existState = await db
        .select()
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
        .get();
      if (existState) {
        const currentActive = existState.activeFormats
          ? (JSON.parse(existState.activeFormats) as string[])
          : [];
        if (!currentActive.includes(row.format)) {
          currentActive.push(row.format);
          await db
            .update(userBookState)
            .set({ activeFormats: JSON.stringify(currentActive) })
            .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)));
        }
      }
    }

    // 9. Handle custom shelves → favorites (Top Shelf Reads)
    if (row.customShelves.length > 0 && bookId) {
      const favoriteShelves = row.customShelves.filter(
        (s) => s.startsWith("favorite") || s.includes("favorite")
      );
      if (favoriteShelves.length > 0) {
        // Add to user's favorites if not already there
        const existingFav = await db
          .select()
          .from(userFavoriteBooks)
          .where(and(eq(userFavoriteBooks.userId, userId), eq(userFavoriteBooks.bookId, bookId)))
          .get();

        if (!existingFav) {
          // Get next position
          const maxPos = await db.all(sql`
            SELECT MAX(position) as max_pos FROM user_favorite_books WHERE user_id = ${userId}
          `) as { max_pos: number | null }[];
          const nextPos = (maxPos[0]?.max_pos ?? 0) + 1;

          await db.insert(userFavoriteBooks).values({
            userId,
            bookId,
            position: nextPos,
          });
        }
      }
    }

    return { status, bookId };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    console.error(`[goodreads-import] Error processing "${row.title}":`, err);
    return { status: "error", error: formatImportError(raw) };
  }
}

/**
 * Import all rows from a Goodreads CSV, yielding progress events.
 */
export async function* importGoodreadsRows(
  rows: GoodreadsRow[],
  userId: string,
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS
): AsyncGenerator<ImportEvent> {
  let imported = 0;
  let existing = 0;
  let skipped = 0;
  const errors: { title: string; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = await processRow(row, userId, options);

    if (result.status === "imported") imported++;
    else if (result.status === "existing") existing++;
    else if (result.status === "skipped") skipped++;
    else if (result.status === "error") {
      errors.push({ title: row.title, error: result.error ?? "Unknown error" });
    }

    yield {
      type: "progress",
      current: i + 1,
      total: rows.length,
      title: row.title,
      status: result.status,
      error: result.error,
    };
  }

  yield {
    type: "done",
    imported,
    existing,
    skipped,
    errors,
  };
}
