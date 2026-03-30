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
  /** User's rating for this book (null if unrated) */
  userRating: number | null;
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
      ) as series_position,
      (
        SELECT ubr.rating
        FROM user_book_ratings ubr
        WHERE ubr.user_id = ${userId} AND ubr.book_id = uf.book_id
      ) as user_rating
    FROM user_favorite_books uf
    JOIN books b ON uf.book_id = b.id
    WHERE uf.user_id = ${userId}
    ORDER BY uf.position ASC
  `) as { book_id: string; position: number; title: string; slug: string | null; cover_image_url: string | null; owned_cover_id: number | null; series_id: string | null; series_position: number | null; user_rating: number | null }[];

  if (rows.length === 0) return [];

  // Batch fetch authors for all books in one query
  const bookIds = rows.map((r) => r.book_id);
  const allAuthors = await db.all(sql`
    SELECT ba.book_id, a.name
    FROM book_authors ba
    JOIN authors a ON ba.author_id = a.id
    WHERE ba.book_id IN (${sql.join(bookIds.map(id => sql`${id}`), sql`, `)})
  `) as { book_id: string; name: string }[];

  const authorsByBook = new Map<string, string[]>();
  for (const a of allAuthors) {
    const arr = authorsByBook.get(a.book_id) ?? [];
    arr.push(a.name);
    authorsByBook.set(a.book_id, arr);
  }

  return rows.map((row) => {
    const effectiveCover = row.owned_cover_id
      ? (buildCoverUrl(row.owned_cover_id, "M") ?? row.cover_image_url)
      : row.cover_image_url;

    return {
      id: row.book_id,
      slug: row.slug,
      title: row.title,
      coverImageUrl: effectiveCover,
      authors: authorsByBook.get(row.book_id) ?? [],
      position: row.position,
      seriesId: row.series_id,
      seriesPosition: row.series_position,
      userRating: row.user_rating,
    };
  });
}

export async function isBookFavorited(userId: string, bookId: string): Promise<number | null> {
  const row = await db
    .select({ position: userFavoriteBooks.position })
    .from(userFavoriteBooks)
    .where(and(eq(userFavoriteBooks.userId, userId), eq(userFavoriteBooks.bookId, bookId)))
    .get();

  return row?.position ?? null;
}
