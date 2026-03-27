import { db } from "@/db";
import { books, bookAuthors, userBookState, userBookRatings, readingSessions, userBookReviews } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { searchOpenLibrary, type OLSearchResult } from "@/lib/openlibrary";
import { importFromOpenLibraryAndReturn, findOrCreateAuthor } from "@/lib/actions/books";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import crypto from "crypto";
import type { StoryGraphRow } from "./parse-storygraph";
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

const OL_DELAY_MS = 150;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize a title for fuzzy matching: lowercase, remove subtitles, articles, punctuation.
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
function isGoodMatch(result: OLSearchResult, row: StoryGraphRow): boolean {
  const normResult = normalizeTitle(result.title);
  const normRow = normalizeTitle(row.title);

  // Exact normalized match
  if (normResult === normRow) return true;

  // Row title contained in result (but result shouldn't be much longer — reject "Summary of X" padding)
  if (normResult.includes(normRow) && normResult.length <= normRow.length * 1.5) return true;
  if (normRow.includes(normResult) && normRow.length <= normResult.length * 1.5) return true;

  // Check word overlap — require high overlap in BOTH directions to avoid
  // matching "Summary and Review of The Midnight Library" for "The Midnight Library"
  const resultWords = normResult.split(" ");
  const rowWords = normRow.split(" ");
  const resultSet = new Set(resultWords);
  const rowSet = new Set(rowWords);
  const matchesFromRow = rowWords.filter((w) => resultSet.has(w)).length;
  const matchesFromResult = resultWords.filter((w) => rowSet.has(w)).length;

  // Both directions must have >= 60% overlap
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
 * Mark a book as owned, optionally adding a format. Merges with existing state.
 * When cleanUnknown is true, strips all "unknown" entries from existing formats.
 */
async function markOwned(userId: string, bookId: string, format: string | null, cleanUnknown: boolean): Promise<void> {
  const existing = await db
    .select()
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, userId),
        eq(userBookState.bookId, bookId)
      )
    )
    .get();

  if (existing) {
    const currentFormats: string[] = existing.ownedFormats
      ? (JSON.parse(existing.ownedFormats) as string[])
      : [];
    let updatedFormats: string[];
    if (cleanUnknown) {
      // Strip all "unknown" entries and merge new format
      updatedFormats = mergeOwnedFormats(currentFormats, format);
    } else {
      // Legacy behavior: just append if not present
      updatedFormats = [...currentFormats];
      if (format && !updatedFormats.includes(format)) {
        updatedFormats.push(format);
      }
    }
    // If no formats at all, default to "unknown" to signal owned
    if (updatedFormats.length === 0) {
      updatedFormats.push("unknown");
    }
    await db
      .update(userBookState)
      .set({
        ownedFormats: JSON.stringify(updatedFormats),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(userBookState.userId, userId),
          eq(userBookState.bookId, bookId)
        )
      );
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
 * Try to find a book already in the DB by title + author (case-insensitive),
 * or by ISBN if provided.
 */
async function findExistingBook(
  title: string,
  authorName: string | null,
  isbn?: string | null
): Promise<string | null> {
  // 1. Try ISBN lookup first (most reliable)
  if (isbn) {
    const isbnField = isbn.length === 13 ? "isbn_13" : "isbn_10";
    const isbnMatch = await db.all(sql`
      SELECT id FROM books WHERE ${sql.raw(isbnField)} = ${isbn} LIMIT 1
    `) as { id: string }[];
    if (isbnMatch[0]) return isbnMatch[0].id;
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
 * Process a single import row. Returns the status of the operation.
 */
async function processRow(
  row: StoryGraphRow,
  userId: string,
  options: ImportOptions
): Promise<{ status: "imported" | "existing" | "skipped" | "error"; error?: string; bookId?: string }> {
  const primaryAuthor = row.authors[0] ?? null;

  try {
    // 1. Check if book already exists in DB (by ISBN first, then title+author)
    let bookId = await findExistingBook(row.title, primaryAuthor, row.isbn);
    let status: "imported" | "existing" = "imported";

    // "existing" means the user already has this book in their library
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

      // 2a. Try ISBN-first lookup (direct hit, much more reliable than text search)
      if (row.isbn) {
        await delay(OL_DELAY_MS);
        const isbnResults = await searchOpenLibrary(row.isbn, 5);
        match = isbnResults.find((r) => isGoodMatch(r, row));
        if (!match && isbnResults.length > 0) {
          // ISBN matched something — trust it even if title match is loose
          match = isbnResults[0];
        }
      }

      // 2b. Fallback to title+author text search
      if (!match) {
        const query = primaryAuthor
          ? `${row.title} ${primaryAuthor}`
          : row.title;

        await delay(OL_DELAY_MS);
        const results = await searchOpenLibrary(query, 5);
        match = results.find((r) => isGoodMatch(r, row));
      }

      if (match) {
        // 3. Import via OL (handles book creation, authors, genres, enrichment)
        bookId = await importFromOpenLibraryAndReturn(match);
        // Enrichment deferred to nightly task — inline enrichment during bulk imports
        // exhausts API quotas and risks function timeouts
        status = "imported";
      } else {
        // 4. No OL match — create minimal book record with available identifiers
        const [book] = await db
          .insert(books)
          .values({
            title: row.title,
            isbn13: row.isbn?.length === 13 ? row.isbn : null,
            isbn10: row.isbn?.length === 10 ? row.isbn : null,
            asin: row.asin ?? null,
          })
          .returning();
        bookId = book.id;

        // Link author if we have one
        if (primaryAuthor) {
          const authorId = await findOrCreateAuthor(primaryAuthor);
          await db
            .insert(bookAuthors)
            .values({ bookId, authorId })
            .onConflictDoNothing();
        }

        // Generate SEO slug
        const { assignBookSlug } = await import("@/lib/utils/slugify");
        await assignBookSlug(bookId, row.title, primaryAuthor ?? "");

        // Enrichment deferred to nightly task — inline enrichment during bulk imports
        // exhausts API quotas and risks function timeouts
        status = "imported";
      }
    }

    const isExistingBook = status === "existing";

    // 5. Set user reading state (direct DB — no server action cookie dependency)
    // Always create user state — if a book is in an export, the user tracked it.
    // Default to "tbr" if no explicit status (prevents orphaned books invisible to the user).
    {
      const existingState = await db
        .select()
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
        .get();

      const stateValue = row.readStatus === "tbr" ? "tbr" : row.readStatus ?? "tbr";

      // Use the completion date as updatedAt so completed books sort by when they were finished
      const updatedAt = row.lastDateRead
        ? `${row.lastDateRead}T00:00:00.000Z`
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

      // Create a completed reading session if we have a completion date
      if ((row.readStatus === "completed" || row.readStatus === "dnf") && row.lastDateRead) {
        const dateStr = row.lastDateRead; // Already "YYYY-MM-DD" from parser
        // Find next read_number for this user+book
        const lastSession = await db.all(sql`
          SELECT MAX(read_number) as max_num FROM reading_sessions
          WHERE user_id = ${userId} AND book_id = ${bookId}
        `) as { max_num: number | null }[];
        const readNumber = (lastSession[0]?.max_num ?? 0) + 1;

        await db.insert(readingSessions).values({
          id: crypto.randomUUID(),
          userId,
          bookId,
          readNumber,
          startedAt: dateStr,
          completionDate: dateStr,
          completionPrecision: "exact",
          state: row.readStatus,
        }).onConflictDoNothing();
      }
    }

    // 6. Set rating if present (direct DB)
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

    // 7. Import review record if rating or written review exists
    if (row.rating || row.review) {
      let plainText: string | null = null;
      if (row.review) {
        // Strip HTML tags for plain text storage
        plainText = row.review
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/?(div|p|em|strong|span|b|i)[^>]*>/gi, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .trim() || null;
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
        if (row.lastDateRead) {
          const parts = row.lastDateRead.split("-");
          finishedYear = parseInt(parts[0], 10) || null;
          finishedMonth = parseInt(parts[1], 10) || null;
        }

        const reviewCreatedAt = row.lastDateRead
          ? `${row.lastDateRead}T12:00:00.000Z`
          : new Date().toISOString();

        await db.insert(userBookReviews).values({
          id: crypto.randomUUID(),
          userId,
          bookId,
          overallRating: row.rating,
          reviewText: plainText,
          didNotFinish: row.readStatus === "dnf",
          contentComments: row.contentWarnings ?? "",
          finishedMonth,
          finishedYear,
          createdAt: reviewCreatedAt,
          source: "storygraph",
        });
      } else if (isExistingBook && options.updateRatingsReviews) {
        // Existing review — fill empty review text + update rating
        const updates: Record<string, unknown> = {};
        if (plainText && !existingReview.reviewText) {
          updates.reviewText = plainText;
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

    // 8. Set owned status — track format if provided, or just mark as owned
    if (row.owned && (!isExistingBook || options.updateOwnedFormats)) {
      await markOwned(userId, bookId, row.format, options.updateOwnedFormats);
    }

    // 9. Set active format for currently reading books based on StoryGraph format
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

    return { status, bookId };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    console.error(`[import] Error processing "${row.title}":`, err);
    return { status: "error", error: formatImportError(raw) };
  }
}

/**
 * Import all rows from a StoryGraph CSV, yielding progress events.
 */
export async function* importStoryGraphRows(
  rows: StoryGraphRow[],
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
