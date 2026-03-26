import { db } from "@/db";
import { editions, userOwnedEditions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function getUserOwnedEditions(userId: string, bookId: string) {
  const rows = await db
    .select({
      editionId: userOwnedEditions.editionId,
      format: userOwnedEditions.format,
      title: editions.title,
      publishDate: editions.publishDate,
      publishers: editions.publishers,
      isbn13: editions.isbn13,
      isbn10: editions.isbn10,
      pages: editions.pages,
      coverId: editions.coverId,
      openLibraryKey: editions.openLibraryKey,
    })
    .from(userOwnedEditions)
    .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
    .where(
      and(
        eq(userOwnedEditions.userId, userId),
        eq(userOwnedEditions.bookId, bookId)
      )
    );

  return rows;
}
