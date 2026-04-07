import { db } from "@/db";
import { userBookRatings } from "@/db/schema";
import { eq, and, or, isNull, avg, count, inArray, sql } from "drizzle-orm";

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
  // Use raw SQL with an INNER JOIN on users so ratings from deleted/missing
  // users don't count. Previously this showed ghost counts on the book page
  // (e.g. Beloved showing "3.8 avg · 6 reviews" from seed data whose users
  // had been deleted) while the reviews list itself was empty.
  let row: { average: number | null; count: number } | undefined;
  try {
    const rows = await db.all(sql`
      SELECT AVG(ubr.rating) AS average, COUNT(ubr.id) AS count
      FROM user_book_ratings ubr
      INNER JOIN users u ON u.id = ubr.user_id
      WHERE ubr.book_id = ${bookId}
        AND (ubr.arc_status IS NULL OR ubr.arc_status = 'approved')
    `) as { average: number | null; count: number }[];
    row = rows[0];
  } catch {
    // Fallback: arc_status column may not exist on production yet
    const rows = await db.all(sql`
      SELECT AVG(ubr.rating) AS average, COUNT(ubr.id) AS count
      FROM user_book_ratings ubr
      INNER JOIN users u ON u.id = ubr.user_id
      WHERE ubr.book_id = ${bookId}
    `) as { average: number | null; count: number }[];
    row = rows[0];
  }

  if (!row || row.count === 0) return null;

  return {
    average: Number(row.average ?? 0),
    count: row.count,
  };
}
