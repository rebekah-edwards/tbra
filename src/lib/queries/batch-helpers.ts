/**
 * Batch query helpers to eliminate N+1 patterns.
 * Instead of querying per-book in a loop, fetch all data for a set of book IDs
 * in one round-trip, then map results in JS.
 */
import { db } from "@/db";
import {
  bookAuthors,
  authors,
  userBookRatings,
  userOwnedEditions,
  editions,
  userBookState,
  bookGenres,
  genres,
  readingSessions,
  bookCategoryRatings,
  taxonomyCategories,
} from "@/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

/** Build a SQL IN clause from an array of string IDs */
function inList(ids: string[]) {
  return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}

/** Batch fetch author names for multiple books → Map<bookId, authorNames[]> */
export async function batchFetchBookAuthors(
  bookIds: string[]
): Promise<Map<string, string[]>> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({ bookId: bookAuthors.bookId, name: authors.name })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(sql`${bookAuthors.bookId} IN (${inList(bookIds)})`)
    .all();

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.bookId) ?? [];
    existing.push(row.name);
    map.set(row.bookId, existing);
  }
  return map;
}

/** Batch fetch user ratings for multiple books → Map<bookId, rating> */
export async function batchFetchUserRatings(
  userId: string,
  bookIds: string[]
): Promise<Map<string, number>> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({ bookId: userBookRatings.bookId, rating: userBookRatings.rating })
    .from(userBookRatings)
    .where(
      and(
        eq(userBookRatings.userId, userId),
        sql`${userBookRatings.bookId} IN (${inList(bookIds)})`
      )
    )
    .all();

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.bookId, row.rating);
  }
  return map;
}

/** Batch fetch edition covers for multiple books → Map<bookId, {coverId, format}[]> */
export async function batchFetchEditionCovers(
  userId: string,
  bookIds: string[]
): Promise<Map<string, { coverId: number | null; format: string | null }[]>> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({
      bookId: userOwnedEditions.bookId,
      coverId: editions.coverId,
      format: userOwnedEditions.format,
    })
    .from(userOwnedEditions)
    .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
    .where(
      and(
        eq(userOwnedEditions.userId, userId),
        sql`${userOwnedEditions.bookId} IN (${inList(bookIds)})`
      )
    )
    .all();

  const map = new Map<string, { coverId: number | null; format: string | null }[]>();
  for (const row of rows) {
    const existing = map.get(row.bookId) ?? [];
    existing.push({ coverId: row.coverId, format: row.format });
    map.set(row.bookId, existing);
  }
  return map;
}

/** Batch fetch user book state (activeFormats, ownedFormats, state) → Map<bookId, state> */
export async function batchFetchBookStates(
  userId: string,
  bookIds: string[]
): Promise<
  Map<string, { state: string | null; ownedFormats: string | null; activeFormats: string | null }>
> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({
      bookId: userBookState.bookId,
      state: userBookState.state,
      ownedFormats: userBookState.ownedFormats,
      activeFormats: userBookState.activeFormats,
    })
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, userId),
        sql`${userBookState.bookId} IN (${inList(bookIds)})`
      )
    )
    .all();

  const map = new Map<
    string,
    { state: string | null; ownedFormats: string | null; activeFormats: string | null }
  >();
  for (const row of rows) {
    map.set(row.bookId, {
      state: row.state,
      ownedFormats: row.ownedFormats,
      activeFormats: row.activeFormats,
    });
  }
  return map;
}

/** Batch fetch top-level genre (parentGenreId IS NULL) for multiple books → Map<bookId, genreName> */
export async function batchFetchTopLevelGenres(
  bookIds: string[]
): Promise<Map<string, string>> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({ bookId: bookGenres.bookId, name: genres.name })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(
      and(
        sql`${bookGenres.bookId} IN (${inList(bookIds)})`,
        isNull(genres.parentGenreId)
      )
    )
    .all();

  // Take first top-level genre per book
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.bookId)) {
      map.set(row.bookId, row.name);
    }
  }
  return map;
}

/** Batch fetch ALL genres for multiple books → Map<bookId, genreNames[]> */
export async function batchFetchBookGenres(
  bookIds: string[]
): Promise<Map<string, string[]>> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({ bookId: bookGenres.bookId, name: genres.name })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(sql`${bookGenres.bookId} IN (${inList(bookIds)})`)
    .all();

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.bookId) ?? [];
    existing.push(row.name);
    map.set(row.bookId, existing);
  }
  return map;
}

/** Batch fetch latest completion year for multiple books → Map<bookId, year> */
export async function batchFetchCompletionYears(
  userId: string,
  bookIds: string[]
): Promise<Map<string, number>> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({
      bookId: readingSessions.bookId,
      completionDate: readingSessions.completionDate,
    })
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        sql`${readingSessions.bookId} IN (${inList(bookIds)})`,
        eq(readingSessions.state, "completed"),
        sql`${readingSessions.completionDate} IS NOT NULL`
      )
    )
    .orderBy(sql`${readingSessions.completionDate} DESC`)
    .all();

  // Take the latest completion date per book
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!map.has(row.bookId) && row.completionDate) {
      const year = parseInt(row.completionDate.substring(0, 4), 10);
      if (!isNaN(year)) map.set(row.bookId, year);
    }
  }
  return map;
}

/** Batch fetch content category ratings for multiple books → Map<bookId, {categoryId, intensity}[]> */
export async function batchFetchBookContentRatings(
  bookIds: string[]
): Promise<Map<string, { categoryId: string; intensity: number }[]>> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({
      bookId: bookCategoryRatings.bookId,
      categoryId: bookCategoryRatings.categoryId,
      intensity: bookCategoryRatings.intensity,
    })
    .from(bookCategoryRatings)
    .where(sql`${bookCategoryRatings.bookId} IN (${inList(bookIds)})`)
    .all();

  const map = new Map<string, { categoryId: string; intensity: number }[]>();
  for (const row of rows) {
    const existing = map.get(row.bookId) ?? [];
    existing.push({ categoryId: row.categoryId, intensity: row.intensity });
    map.set(row.bookId, existing);
  }
  return map;
}
