import { db } from "@/db";
import { userBookRatings } from "@/db/schema";
import { eq, and, or, isNull, avg, count, inArray } from "drizzle-orm";

export async function getUserBookRating(
  userId: string,
  bookId: string
): Promise<number | null> {
  const row = await db
    .select({ rating: userBookRatings.rating })
    .from(userBookRatings)
    .where(
      and(
        eq(userBookRatings.userId, userId),
        eq(userBookRatings.bookId, bookId)
      )
    )
    .get();

  return row?.rating ?? null;
}

export async function getBulkAggregateRatings(
  bookIds: string[]
): Promise<Map<string, number>> {
  if (bookIds.length === 0) return new Map();
  const rows = await db
    .select({
      bookId: userBookRatings.bookId,
      average: avg(userBookRatings.rating),
      cnt: count(userBookRatings.id),
    })
    .from(userBookRatings)
    .where(inArray(userBookRatings.bookId, bookIds))
    .groupBy(userBookRatings.bookId)
    .all();
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.cnt > 0 && row.average != null) {
      map.set(row.bookId, Number(row.average));
    }
  }
  return map;
}

export async function getBookAggregateRating(
  bookId: string
): Promise<{ average: number; count: number } | null> {
  const row = await db
    .select({
      average: avg(userBookRatings.rating),
      count: count(userBookRatings.id),
    })
    .from(userBookRatings)
    .where(
      and(
        eq(userBookRatings.bookId, bookId),
        or(isNull(userBookRatings.arcStatus), eq(userBookRatings.arcStatus, "approved"))
      )
    )
    .get();

  if (!row || row.count === 0) return null;

  return {
    average: Number(row.average),
    count: row.count,
  };
}
