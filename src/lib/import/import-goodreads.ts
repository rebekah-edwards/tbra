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
import { findOrCreateAuthor } from "@/lib/actions/books";
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
  /** Book IDs that were newly created and need enrichment (Phase 2) */
  newBookIds: string[];
}

export type ImportEvent = ImportProgress | ImportDone;

/**
 * Normalize a title for fuzzy matching during import.
 * Strips parenthetical suffixes and common noise words.
 * Does NOT strip "#N" or "Book N" — those distinguish different books in a series.
 */
export function normalizeImportTitle(title: string): string {
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

/**
 * Try to find a book already in the DB by title + author (case-insensitive),
 * or by ISBN if provided. Also tries normalized title matching to catch
 * editions with parenthetical series info (e.g., "Red Rising (Red Rising Saga, #1)").
 */
export async function findExistingBook(
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

  // 2. Try exact title + author match
  const exactMatches = await db.all(sql`
    SELECT b.id, b.title
    FROM books b
    LEFT JOIN book_authors ba ON b.id = ba.book_id
    LEFT JOIN authors a ON ba.author_id = a.id
    WHERE LOWER(b.title) = LOWER(${title})
    ${authorName ? sql`AND LOWER(a.name) = LOWER(${authorName})` : sql``}
    LIMIT 1
  `) as { id: string; title: string }[];

  if (exactMatches[0]) return exactMatches[0].id;

  // 3. Try normalized title matching (catches parenthetical editions)
  if (authorName) {
    const normalizedInput = normalizeImportTitle(title);
    if (normalizedInput) {
      // Fetch candidates by author, then filter by normalized title in JS
      // (SQLite can't easily do the full normalization in SQL)
      const candidates = await db.all(sql`
        SELECT b.id, b.title
        FROM books b
        JOIN book_authors ba ON b.id = ba.book_id
        JOIN authors a ON ba.author_id = a.id
        WHERE LOWER(a.name) = LOWER(${authorName})
      `) as { id: string; title: string }[];

      for (const candidate of candidates) {
        if (normalizeImportTitle(candidate.title) === normalizedInput) {
          return candidate.id;
        }
      }
    }
  }

  return null;
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
 * Phase 1: Fast import — process a single Goodreads row.
 * NO OpenLibrary searches, NO enrichment API calls.
 * Matches by ISBN/title to existing DB records. If not found, creates a minimal book record.
 */
async function processRow(
  row: GoodreadsRow,
  userId: string,
  options: ImportOptions,
  cache?: LookupCache
): Promise<{ status: "imported" | "existing" | "skipped" | "error"; error?: string; bookId?: string; isNewBook?: boolean }> {
  try {
    // 1. Check if book already exists — use cache if available (fast), fall back to DB query
    let bookId = cache
      ? cache.findBook(row.title, row.author || null, row.isbn13, row.isbn10)
      : await findExistingBook(row.title, row.author || null, row.isbn13, row.isbn10);
    let status: "imported" | "existing" = "imported";
    let isNewBook = false;

    if (bookId) {
      const hasState = cache ? cache.hasUserState(bookId) : !!(await db
        .select()
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
        .get());
      status = hasState ? "existing" : "imported";

      // Re-import mode: skip books the user already has entirely
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
          isbn13: row.isbn13,
          isbn10: row.isbn10,
          pages: row.pages,
          publicationYear: row.originalPublicationYear || row.yearPublished,
        })
        .returning();
      bookId = book.id;
      isNewBook = true;

      // Register in cache so duplicate CSV rows don't create duplicates
      cache?.registerBook(bookId, row.title, row.author || null, row.isbn13, row.isbn10);

      if (row.author) {
        const authorId = cache
          ? await cache.getOrCreateAuthor(row.author)
          : await findOrCreateAuthor(row.author);
        await db.insert(bookAuthors).values({ bookId, authorId }).onConflictDoNothing();
      }

      // Additional authors
      for (const additionalAuthor of row.additionalAuthors) {
        const authorId = cache
          ? await cache.getOrCreateAuthor(additionalAuthor)
          : await findOrCreateAuthor(additionalAuthor);
        await db.insert(bookAuthors).values({ bookId, authorId }).onConflictDoNothing();
      }

      // Generate SEO slug — use cache if available (avoids DB round-trip for collision check)
      if (cache) {
        const slug = cache.generateSlug(row.title, row.author ?? "");
        await db.all(sql`UPDATE books SET slug = ${slug} WHERE id = ${bookId}`);
      } else {
        const { assignBookSlug } = await import("@/lib/utils/slugify");
        await assignBookSlug(bookId, row.title, row.author ?? "");
      }

      status = "imported";
    }

    const isExistingBook = status === "existing";

    // 3. Link to series if parsed from title
    if (row.seriesName) {
      const seriesId = await findOrCreateSeries(row.seriesName);
      await linkBookToSeries(bookId, seriesId, row.seriesPosition);
    }

    // 4. Set user reading state
    {
      const cachedState = cache?.getUserState(bookId);
      const existingState = cachedState !== undefined
        ? (cachedState !== null ? { state: cachedState } : null)
        : await db
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

      // Create reading sessions for completed/currently-reading books
      // Goodreads only provides ONE dateRead even for re-reads, so we only create
      // ONE session with the known date. Re-read count is noted but we don't
      // fabricate dates for reads we don't have dates for.
      if (row.readStatus === "completed" || row.readStatus === "currently_reading") {
        const dateStr = row.dateRead || new Date().toISOString().slice(0, 10);

        await db.insert(readingSessions).values({
          id: crypto.randomUUID(),
          userId,
          bookId,
          readNumber: 1,
          startedAt: dateStr,
          completionDate: row.readStatus === "completed" ? dateStr : null,
          completionPrecision: row.dateRead ? "exact" : null,
          state: row.readStatus,
        }).onConflictDoNothing();
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
        const existingFav = await db
          .select()
          .from(userFavoriteBooks)
          .where(and(eq(userFavoriteBooks.userId, userId), eq(userFavoriteBooks.bookId, bookId)))
          .get();

        if (!existingFav) {
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

    return { status, bookId, isNewBook };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    console.error(`[goodreads-import] Error processing "${row.title}":`, err);
    return { status: "error", error: formatImportError(raw) };
  }
}

/**
 * Pre-load lookup caches to avoid per-book DB round-trips.
 * This turns ~1800 remote queries into 3-4 bulk queries at startup.
 */
export async function buildLookupCache(userId: string) {
  // Load all ISBNs → book ID
  const isbn13Map = new Map<string, string>();
  const isbn10Map = new Map<string, string>();
  const allIsbns = await db.all(sql`
    SELECT id, isbn_13, isbn_10 FROM books
    WHERE isbn_13 IS NOT NULL OR isbn_10 IS NOT NULL
  `) as { id: string; isbn_13: string | null; isbn_10: string | null }[];
  for (const row of allIsbns) {
    if (row.isbn_13) isbn13Map.set(row.isbn_13, row.id);
    if (row.isbn_10) isbn10Map.set(row.isbn_10, row.id);
  }

  // Load all title+author combos → book ID (exact and normalized)
  const titleAuthorMap = new Map<string, string>();
  const normalizedTitleAuthorMap = new Map<string, string>();
  const allBooks = await db.all(sql`
    SELECT b.id, LOWER(b.title) as title_lower, LOWER(a.name) as author_lower
    FROM books b
    LEFT JOIN book_authors ba ON b.id = ba.book_id
    LEFT JOIN authors a ON ba.author_id = a.id
  `) as { id: string; title_lower: string; author_lower: string | null }[];
  for (const row of allBooks) {
    const key = row.author_lower ? `${row.title_lower}|||${row.author_lower}` : row.title_lower;
    titleAuthorMap.set(key, row.id);
    // Also store title-only as fallback
    if (!titleAuthorMap.has(row.title_lower)) {
      titleAuthorMap.set(row.title_lower, row.id);
    }
    // Build normalized title map for fuzzy matching
    const normTitle = normalizeImportTitle(row.title_lower);
    if (normTitle && row.author_lower) {
      const normKey = `${normTitle}|||${row.author_lower.replace(/[^a-z]/g, "")}`;
      // Prefer entries without parenthetical titles (cleaner canonical)
      if (!normalizedTitleAuthorMap.has(normKey) || !row.title_lower.includes("(")) {
        normalizedTitleAuthorMap.set(normKey, row.id);
      }
    }
  }

  // Load user's existing book states
  const userStateMap = new Map<string, string>();
  const userStates = await db.all(sql`
    SELECT book_id, state FROM user_book_state WHERE user_id = ${userId}
  `) as { book_id: string; state: string }[];
  for (const row of userStates) {
    userStateMap.set(row.book_id, row.state);
  }

  // Pre-load all authors by name → ID (avoids per-book findOrCreateAuthor queries)
  const authorMap = new Map<string, string>();
  const allAuthors = await db.all(sql`
    SELECT id, LOWER(name) as name_lower FROM authors
  `) as { id: string; name_lower: string }[];
  for (const row of allAuthors) {
    authorMap.set(row.name_lower, row.id);
  }

  // Pre-load existing slugs to avoid collision checks
  const slugSet = new Set<string>();
  const allSlugs = await db.all(sql`
    SELECT slug FROM books WHERE slug IS NOT NULL
  `) as { slug: string }[];
  for (const row of allSlugs) {
    slugSet.add(row.slug);
  }

  return {
    isbn13Map,
    isbn10Map,
    titleAuthorMap,
    userStateMap,
    authorMap,
    slugSet,
    findBook(title: string, author: string | null, isbn13?: string | null, isbn10?: string | null): string | null {
      if (isbn13 && isbn13Map.has(isbn13)) return isbn13Map.get(isbn13)!;
      if (isbn10 && isbn10Map.has(isbn10)) return isbn10Map.get(isbn10)!;
      const titleLower = title.toLowerCase();
      if (author) {
        const key = `${titleLower}|||${author.toLowerCase()}`;
        if (titleAuthorMap.has(key)) return titleAuthorMap.get(key)!;
        // Try normalized title matching (catches parenthetical editions)
        const normTitle = normalizeImportTitle(titleLower);
        const normAuthor = author.toLowerCase().replace(/[^a-z]/g, "");
        if (normTitle && normAuthor) {
          const normKey = `${normTitle}|||${normAuthor}`;
          if (normalizedTitleAuthorMap.has(normKey)) return normalizedTitleAuthorMap.get(normKey)!;
        }
      }
      return titleAuthorMap.get(titleLower) ?? null;
    },
    hasUserState(bookId: string): boolean {
      return userStateMap.has(bookId);
    },
    getUserState(bookId: string): string | null {
      return userStateMap.get(bookId) ?? null;
    },
    // Register newly created books so subsequent rows can find them
    registerBook(bookId: string, title: string, author: string | null, isbn13?: string | null, isbn10?: string | null) {
      if (isbn13) isbn13Map.set(isbn13, bookId);
      if (isbn10) isbn10Map.set(isbn10, bookId);
      const titleLower = title.toLowerCase();
      if (author) {
        titleAuthorMap.set(`${titleLower}|||${author.toLowerCase()}`, bookId);
        // Also register normalized version
        const normTitle = normalizeImportTitle(titleLower);
        const normAuthor = author.toLowerCase().replace(/[^a-z]/g, "");
        if (normTitle && normAuthor) {
          normalizedTitleAuthorMap.set(`${normTitle}|||${normAuthor}`, bookId);
        }
      }
      titleAuthorMap.set(titleLower, bookId);
    },
    registerUserState(bookId: string, state: string) {
      userStateMap.set(bookId, state);
    },
    /** Get or create an author — uses cache to avoid DB lookup for known authors */
    async getOrCreateAuthor(name: string): Promise<string> {
      const key = name.toLowerCase();
      const cached = authorMap.get(key);
      if (cached) return cached;
      // Not in cache — create in DB
      const id = crypto.randomUUID();
      await db.all(sql`INSERT OR IGNORE INTO authors (id, name) VALUES (${id}, ${name})`);
      // Check if it was actually inserted or already existed (race condition)
      const existing = await db.all(sql`SELECT id FROM authors WHERE LOWER(name) = ${key} LIMIT 1`) as { id: string }[];
      const authorId = existing[0]?.id ?? id;
      authorMap.set(key, authorId);
      return authorId;
    },
    /** Generate a unique slug without DB round-trip for collision check */
    generateSlug(title: string, author: string): string {
      const base = `${title} ${author}`
        .toLowerCase()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
      let slug = base;
      let i = 2;
      while (slugSet.has(slug)) {
        slug = `${base}-${i}`;
        i++;
      }
      slugSet.add(slug);
      return slug;
    },
  };
}

type LookupCache = Awaited<ReturnType<typeof buildLookupCache>>;

/**
 * Phase 1: Fast import all rows from a Goodreads CSV, yielding progress events.
 * No OL searches or enrichment — just DB matching and record creation.
 * Returns newBookIds in the done event for Phase 2 enrichment.
 */
export async function* importGoodreadsRows(
  rows: GoodreadsRow[],
  userId: string,
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS
): AsyncGenerator<ImportEvent> {
  // Pre-load all lookup data into memory (3-4 bulk queries instead of ~1800 per-book queries)
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
