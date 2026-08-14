/**
 * Recording a printing that did NOT come from OpenLibrary as an edition of the
 * canon book — the ISBNdb/Google Books deluxe hardcover, the anniversary
 * printing, the signed edition.
 *
 * This is what makes "merge the special edition" mean more than "delete the
 * duplicate row". Ingestion calls it when a decorated title resolves to an
 * existing canon book: instead of minting a second `books` row, or discarding
 * the printing entirely, the ISBN, cover and page count land here and the
 * printing appears in the Owned picker.
 *
 * Lives outside `lib/actions/editions.ts` on purpose — that file is
 * `"use server"`, and the nightly scripts need to call this directly.
 */
import { db } from "@/db";
import { editions } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export interface LocalEditionInput {
  bookId: string;
  title?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  pages?: number | null;
  publisher?: string | null;
  publishDate?: string | null;
  coverUrl?: string | null;
  /** hardcover | paperback | ebook | audiobook */
  format?: string | null;
  /** e.g. "Deluxe Limited Edition" */
  editionLabel?: string | null;
  source: "isbndb" | "google_books" | "merge" | "manual";
  /** The books.id this printing arrived as, when folding an existing row in. */
  mergedFromBookId?: string | null;
}

/**
 * Insert (or return the existing) local edition row for a book.
 *
 * `open_library_key` stays NOT NULL UNIQUE — dropping that would mean
 * rebuilding the table on production Turso — so local rows carry a synthetic
 * `local:<uuid>` key. `source` is what tells callers whether an OpenLibrary
 * fetch against the key is meaningful; never test the key for nullness.
 *
 * Returns the edition id, or null when there is nothing worth recording.
 */
export async function recordLocalEdition(params: LocalEditionInput): Promise<string | null> {
  const { bookId, isbn13, isbn10 } = params;
  if (!bookId) return null;

  // A printing with no ISBN and no label carries nothing the canon book
  // doesn't already have — don't clutter the picker with it.
  if (!isbn13 && !isbn10 && !params.editionLabel) return null;

  // Idempotent by (book, ISBN) so re-running a backfill or re-importing the
  // same ISBN never stacks duplicate rows in the picker.
  if (isbn13 || isbn10) {
    const existing = await db
      .select({ id: editions.id })
      .from(editions)
      .where(
        and(
          eq(editions.bookId, bookId),
          isbn13 ? eq(editions.isbn13, isbn13) : eq(editions.isbn10, isbn10!),
        ),
      )
      .get();
    if (existing) return existing.id;
  }

  const id = crypto.randomUUID();
  await db.insert(editions).values({
    id,
    openLibraryKey: `local:${id}`,
    bookId,
    title: params.title ?? null,
    publishDate: params.publishDate ?? null,
    publishers: params.publisher ? JSON.stringify([params.publisher]) : null,
    isbn13: isbn13 ?? null,
    isbn10: isbn10 ?? null,
    pages: params.pages ?? null,
    coverId: null,
    source: params.source,
    coverUrl: params.coverUrl ?? null,
    format: params.format ?? null,
    editionLabel: params.editionLabel ?? null,
    mergedFromBookId: params.mergedFromBookId ?? null,
  });
  return id;
}
