import { db } from "@/db";
import { userBookRatings } from "@/db/schema";
import { eq, and, avg, count } from "drizzle-orm";

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

export async function getBookAggregateRating(
  bookId: string
): Promise<{ average: number; count: number } | null> {
  const row = await db
    .select({
      average: avg(userBookRatings.rating),
      count: count(userBookRatings.id),
    })
    .from(userBookRatings)
    .where(eq(userBookRatings.bookId, bookId))
    .get();

  if (!row || row.count === 0) return null;

  return {
    average: Number(row.average),
    count: row.count,
  };
}
