import { db } from "@/db";
import { books, bookAuthors, userBookState, readingSessions } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { findOrCreateAuthor } from "@/lib/actions/books";
import crypto from "crypto";
import type { LibbyRow } from "./parse-libby";
import { formatImportError, type ImportOptions, DEFAULT_IMPORT_OPTIONS } from "./import-options";

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

/** Reading state to assign to imported books */
export type LibbyDefaultState = "completed" | "tbr" | "review";

/**
 * Phase 1: Fast import — process a single Libby row.
 * NO OpenLibrary searches, NO enrichment API calls.
 * Matches by ISBN/title to existing DB records. If not found, creates a minimal book record.
 */
async function processRow(
  row: LibbyRow,
  userId: string,
  options: ImportOptions,
  defaultState: LibbyDefaultState,
  cache: Awaited<ReturnType<typeof import("./import-goodreads")["buildLookupCache"]>>
): Promise<{ status: "imported" | "existing" | "skipped" | "error"; error?: string; bookId?: string; isNewBook?: boolean }> {
  const primaryAuthor = row.authors[0] ?? null;
  // Libby ISBNs are audiobook ISBNs — try as both isbn13 and isbn10
  const isbn13 = row.isbn?.length === 13 ? row.isbn : null;
  const isbn10 = row.isbn?.length === 10 ? row.isbn : null;

  try {
    // 1. Check if book already exists — use cache for fast matching
    let bookId = cache.findBook(row.title, primaryAuthor, isbn13, isbn10);

    // Try matching without leading zeros for audiobook ISBNs (some formats differ)
    if (!bookId && row.isbn) {
      const stripped = row.isbn.replace(/^0+/, "");
      if (stripped !== row.isbn) {
        bookId = cache.findBook(row.title, primaryAuthor,
          stripped.length === 13 ? stripped : null,
          stripped.length === 10 ? stripped : null
        );
      }
    }

    let status: "imported" | "existing" = "imported";
    let isNewBook = false;

    if (bookId) {
      const hasState = cache.hasUserState(bookId);
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
          isbn13,
          isbn10,
        })
        .returning();
      bookId = book.id;
      isNewBook = true;

      cache.registerBook(bookId, row.title, primaryAuthor, isbn13, isbn10);

      // Link all authors
      for (const authorName of row.authors) {
        const authorId = await findOrCreateAuthor(authorName);
        await db.insert(bookAuthors).values({ bookId, authorId }).onConflictDoNothing();
      }

      // Generate SEO slug
      const { assignBookSlug } = await import("@/lib/utils/slugify");
      await assignBookSlug(bookId, row.title, primaryAuthor ?? "");

      status = "imported";
    }

    const isExistingBook = status === "existing";

    // 2. Set user reading state (only if defaultState is not "review" — that's handled by the UI)
    if (defaultState !== "review") {
      const stateValue = defaultState === "completed" ? "completed" : "tbr";

      const cachedState = cache.getUserState(bookId);
      const existingState = cachedState !== undefined
        ? (cachedState !== null ? { state: cachedState } : null)
        : await db
            .select()
            .from(userBookState)
            .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
            .get();

      const updatedAt = row.borrowDate
        ? `${row.borrowDate}T00:00:00.000Z`
        : new Date().toISOString();

      if (existingState) {
        if (!isExistingBook || options.updateReadingStates) {
          await db
            .update(userBookState)
            .set({ state: stateValue, updatedAt })
            .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)));
          cache.registerUserState(bookId, stateValue);
        }
      } else {
        await db.insert(userBookState).values({
          userId,
          bookId,
          state: stateValue,
          updatedAt,
        });
        cache.registerUserState(bookId, stateValue);
      }

      // Create a reading session for completed books
      if (stateValue === "completed") {
        const dateStr = row.borrowDate;
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
          state: "completed",
        }).onConflictDoNothing();
      }
    }

    // 3. Set active format to audiobook (Libby is always audiobook loans)
    {
      const existState = await db
        .select()
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
        .get();
      if (existState) {
        const currentActive = existState.activeFormats
          ? (JSON.parse(existState.activeFormats) as string[])
          : [];
        if (!currentActive.includes("audiobook")) {
          currentActive.push("audiobook");
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
    console.error(`[libby-import] Error processing "${row.title}":`, err);
    return { status: "error", error: formatImportError(raw) };
  }
}

/**
 * Phase 1: Fast import all rows from a Libby CSV, yielding progress events.
 * No OL searches or enrichment — just DB matching and record creation.
 * Returns newBookIds in the done event for Phase 2 enrichment.
 */
export async function* importLibbyRows(
  rows: LibbyRow[],
  userId: string,
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS,
  defaultState: LibbyDefaultState = "completed"
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
    const result = await processRow(row, userId, options, defaultState, cache);

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
