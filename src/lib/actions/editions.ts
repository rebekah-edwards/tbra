"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { books, editions, userOwnedEditions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchWorkEditions,
  classifyEditionFormat,
  type OLEdition,
} from "@/lib/openlibrary";

export async function importEdition(
  bookId: string,
  olEdition: OLEdition
): Promise<string> {
  // Check if already cached
  const existing = await db
    .select({ id: editions.id })
    .from(editions)
    .where(eq(editions.openLibraryKey, olEdition.key))
    .get();

  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await db.insert(editions).values({
    id,
    openLibraryKey: olEdition.key,
    bookId,
    title: olEdition.title ?? null,
    publishDate: olEdition.publish_date ?? null,
    publishers: olEdition.publishers ? JSON.stringify(olEdition.publishers) : null,
    isbn13: olEdition.isbn_13?.[0] ?? null,
    isbn10: olEdition.isbn_10?.[0] ?? null,
    pages: olEdition.number_of_pages ?? null,
    coverId: olEdition.covers?.[0] ?? null,
  });

  return id;
}

export async function setOwnedEdition(
  bookId: string,
  editionId: string,
  format: string
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Insert or ignore (unique constraint handles duplicates)
  await db
    .insert(userOwnedEditions)
    .values({
      userId: user.userId,
      bookId,
      editionId,
      format,
    })
    .onConflictDoNothing();

  revalidatePath(`/book/${bookId}`);
}

export async function removeOwnedEdition(
  bookId: string,
  editionId: string,
  format: string
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await db
    .delete(userOwnedEditions)
    .where(
      and(
        eq(userOwnedEditions.userId, user.userId),
        eq(userOwnedEditions.bookId, bookId),
        eq(userOwnedEditions.editionId, editionId),
        eq(userOwnedEditions.format, format)
      )
    );

  revalidatePath(`/book/${bookId}`);
}

/**
 * Auto-find and link the best OL edition for a given format.
 * Used when the user selects a reading format but hasn't manually picked an edition.
 * Returns the new EditionSelection if one was linked, or null.
 */
export async function autoLinkFormatEdition(
  bookId: string,
  format: string
): Promise<{
  editionId: string;
  format: string;
  openLibraryKey: string;
  coverId: number | null;
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  // Check if user already has an edition for this format
  const existing = await db
    .select({ editionId: userOwnedEditions.editionId })
    .from(userOwnedEditions)
    .where(
      and(
        eq(userOwnedEditions.userId, user.userId),
        eq(userOwnedEditions.bookId, bookId),
        eq(userOwnedEditions.format, format)
      )
    )
    .get();

  if (existing) {
    // Already have an edition for this format — return its info
    const ed = await db
      .select({
        openLibraryKey: editions.openLibraryKey,
        coverId: editions.coverId,
      })
      .from(editions)
      .where(eq(editions.id, existing.editionId))
      .get();
    return ed
      ? {
          editionId: existing.editionId,
          format,
          openLibraryKey: ed.openLibraryKey,
          coverId: ed.coverId,
        }
      : null;
  }

  // Get the book's OL work key
  const book = await db
    .select({ openLibraryKey: books.openLibraryKey })
    .from(books)
    .where(eq(books.id, bookId))
    .get();

  if (!book?.openLibraryKey) return null;

  // Fetch editions from OL and find the best match for this format
  let bestEdition: OLEdition | null = null;
  let offset = 0;
  const PAGE_SIZE = 50;
  const MAX_EDITIONS = 200;

  while (offset < MAX_EDITIONS) {
    const { entries, size } = await fetchWorkEditions(
      book.openLibraryKey,
      PAGE_SIZE,
      offset
    );
    if (entries.length === 0) break;

    for (const edition of entries) {
      const coverId = edition.covers?.[0];
      if (!coverId || coverId <= 0) continue;

      const classified = classifyEditionFormat(edition.physical_format);
      if (classified !== format) continue;

      // Prefer English editions
      const langs = edition.languages?.map((l) => l.key) ?? [];
      const isEnglish =
        langs.length === 0 || langs.some((k) => k === "/languages/eng");
      if (!isEnglish && langs.length > 0) continue;

      // Take the first matching edition with a cover
      bestEdition = edition;
      break;
    }

    if (bestEdition) break;
    offset += PAGE_SIZE;
    if (offset >= size) break;
  }

  if (!bestEdition) return null;

  // Import and link
  const editionId = await importEdition(bookId, bestEdition);
  await db
    .insert(userOwnedEditions)
    .values({
      userId: user.userId,
      bookId,
      editionId,
      format,
    })
    .onConflictDoNothing();

  revalidatePath(`/book/${bookId}`);

  return {
    editionId,
    format,
    openLibraryKey: bestEdition.key,
    coverId: bestEdition.covers?.[0] ?? null,
  };
}
