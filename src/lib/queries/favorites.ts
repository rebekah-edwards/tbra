import { db } from "@/db";
import { userFavoriteBooks, books, bookAuthors, authors } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { buildCoverUrl } from "@/lib/openlibrary";

export interface FavoriteBook {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  position: number;
  /** Primary series ID (null if standalone) */
  seriesId: string | null;
  /** Position within that series */
  seriesPosition: number | null;
}

export async function getUserFavorites(userId: string): Promise<FavoriteBook[]> {
  // Fetch favorites with owned edition cover ID and series info
  const rows = await db.all(sql`
    SELECT
      uf.book_id,
      uf.position,
      b.title,
      b.slug,
      b.cover_image_url,
      (
        SELECT e.cover_id
        FROM user_owned_editions uoe
        JOIN editions e ON uoe.edition_id = e.id
        WHERE uoe.user_id = ${userId}
          AND uoe.book_id = uf.book_id
          AND e.cover_id IS NOT NULL
        LIMIT 1
      ) as owned_cover_id,
      (
        SELECT bs.series_id
        FROM book_series bs
        WHERE bs.book_id = uf.book_id
        LIMIT 1
      ) as series_id,
      (
        SELECT bs.position_in_series
        FROM book_series bs
        WHERE bs.book_id = uf.book_id
        LIMIT 1
      ) as series_position
    FROM user_favorite_books uf
    JOIN books b ON uf.book_id = b.id
    WHERE uf.user_id = ${userId}
    ORDER BY uf.position ASC
  `) as { book_id: string; position: number; title: string; slug: string | null; cover_image_url: string | null; owned_cover_id: number | null; series_id: string | null; series_position: number | null }[];

  const result: FavoriteBook[] = [];
  for (const row of rows) {
    const authorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, row.book_id))
      .all();

    // Use owned edition cover if available, otherwise fall back to base cover
    const effectiveCover = row.owned_cover_id
      ? (buildCoverUrl(row.owned_cover_id, "M") ?? row.cover_image_url)
      : row.cover_image_url;

    result.push({
      id: row.book_id,
      slug: row.slug,
      title: row.title,
      coverImageUrl: effectiveCover,
      authors: authorRows.map((a) => a.name),
      position: row.position,
      seriesId: row.series_id,
      seriesPosition: row.series_position,
    });
  }

  return result;
}

export async function isBookFavorited(userId: string, bookId: string): Promise<number | null> {
  const row = await db
    .select({ position: userFavoriteBooks.position })
    .from(userFavoriteBooks)
    .where(and(eq(userFavoriteBooks.userId, userId), eq(userFavoriteBooks.bookId, bookId)))
    .get();

  return row?.position ?? null;
}
