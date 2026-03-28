import { db } from "@/db";
import { books, bookAuthors, userBookState, userBookRatings, readingSessions, userBookReviews } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { findOrCreateAuthor } from "@/lib/actions/books";
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
  /** Book IDs that were newly created and need enrichment (Phase 2) */
  newBookIds: string[];
}

export type ImportEvent = ImportProgress | ImportDone;

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
 * Phase 1: Fast import — process a single StoryGraph row.
 * NO OpenLibrary searches, NO enrichment API calls.
 * Matches by ISBN/title to existing DB records. If not found, creates a minimal book record.
 */
async function processRow(
  row: StoryGraphRow,
  userId: string,
  options: ImportOptions,
  cache?: Awaited<ReturnType<typeof import("./import-goodreads")["buildLookupCache"]>>
): Promise<{ status: "imported" | "existing" | "skipped" | "error"; error?: string; bookId?: string; isNewBook?: boolean }> {
  const primaryAuthor = row.authors[0] ?? null;
  const isbn13 = row.isbn?.length === 13 ? row.isbn : null;
  const isbn10 = row.isbn?.length === 10 ? row.isbn : null;

  try {
    // 1. Check if book already exists — use cache if available (fast)
    let bookId = cache
      ? cache.findBook(row.title, primaryAuthor, isbn13, isbn10)
      : await findExistingBook(row.title, primaryAuthor, row.isbn);
    let status: "imported" | "existing" = "imported";
    let isNewBook = false;

    if (bookId) {
      const hasState = cache ? cache.hasUserState(bookId) : !!(await db
        .select()
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
        .get());
      status = hasState ? "existing" : "imported";

      if (options.isReimport && hasState) {
        return { status: "skipped", bookId };
      }
    }

    if (!bookId) {
      // Create minimal book record from CSV data — no OL search
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
      isNewBook = true;

      cache?.registerBook(bookId, row.title, primaryAuthor, isbn13, isbn10);

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

      status = "imported";
    }

    const isExistingBook = status === "existing";

    // 5. Set user reading state
    {
      const cachedState = cache?.getUserState(bookId);
      const existingState = cachedState !== undefined
        ? (cachedState !== null ? { state: cachedState } : null)
        : await db
            .select()
            .from(userBookState)
            .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
            .get();

      const stateValue = row.readStatus === "tbr" ? "tbr" : row.readStatus ?? "tbr";

      const updatedAt = row.lastDateRead
        ? `${row.lastDateRead}T00:00:00.000Z`
        : new Date().toISOString();

      if (existingState) {
        const shouldUpdateState = !isExistingBook || (
          options.updateReadingStates &&
          isStateProgression(existingState.state, stateValue)
        );
        if (shouldUpdateState) {
          await db
            .update(userBookState)
            .set({ state: stateValue ?? existingState.state, updatedAt })
            .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)));
          cache?.registerUserState(bookId, stateValue ?? existingState.state);
        }
      } else {
        await db.insert(userBookState).values({
          userId,
          bookId,
          state: stateValue,
          updatedAt,
        });
        cache?.registerUserState(bookId, stateValue);
      }

      // Create a reading session for completed, dnf, or paused books
      if ((row.readStatus === "completed" || row.readStatus === "dnf") && row.lastDateRead) {
        const dateStr = row.lastDateRead;
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
      } else if (row.readStatus === "paused") {
        // Create a paused session so it has a start date
        const lastSession = await db.all(sql`
          SELECT MAX(read_number) as max_num FROM reading_sessions
          WHERE user_id = ${userId} AND book_id = ${bookId}
        `) as { max_num: number | null }[];
        const readNumber = (lastSession[0]?.max_num ?? 0) + 1;
        const startDate = row.lastDateRead || new Date().toISOString().split("T")[0];

        await db.insert(readingSessions).values({
          id: crypto.randomUUID(),
          userId,
          bookId,
          readNumber,
          startedAt: startDate,
          state: "paused",
        }).onConflictDoNothing();
      }
    }

    // 6. Set rating if present
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

    // 7. Import review record
    if (row.rating || row.review) {
      let plainText: string | null = null;
      if (row.review) {
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

    // 8. Set owned status
    if (row.owned && (!isExistingBook || options.updateOwnedFormats)) {
      await markOwned(userId, bookId, row.format, options.updateOwnedFormats);
    }

    // 9. Set active format for currently reading or paused books
    if (row.format && (row.readStatus === "currently_reading" || row.readStatus === "paused")) {
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

    return { status, bookId, isNewBook };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    console.error(`[import] Error processing "${row.title}":`, err);
    return { status: "error", error: formatImportError(raw) };
  }
}

/**
 * Phase 1: Fast import all rows from a StoryGraph CSV, yielding progress events.
 * No OL searches or enrichment — just DB matching and record creation.
 * Returns newBookIds in the done event for Phase 2 enrichment.
 */
export async function* importStoryGraphRows(
  rows: StoryGraphRow[],
  userId: string,
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS
): AsyncGenerator<ImportEvent> {
  // Pre-load all lookup data into memory for fast matching
  const { buildLookupCache } = await import("./import-goodreads");
  const cache = await buildLookupCache(userId);

  let imported = 0;
  let existing = 0;
  let skipped = 0;
  const errors: { title: string; error: string }[] = [];
  const newBookIds: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = await processRow(row, userId, options, cache);

    if (result.status === "imported") imported++;
    else if (result.status === "existing") existing++;
    else if (result.status === "skipped") skipped++;
    else if (result.status === "error") {
      errors.push({ title: row.title, error: result.error ?? "Unknown error" });
    }

    // Track newly created books for Phase 2 enrichment
    if (result.isNewBook && result.bookId) {
      newBookIds.push(result.bookId);
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
    newBookIds,
  };
}
