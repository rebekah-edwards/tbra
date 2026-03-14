"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { editions, userOwnedEditions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import type { OLEdition } from "@/lib/openlibrary";

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
