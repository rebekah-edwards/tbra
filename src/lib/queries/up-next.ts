import { db } from "@/db";
import { upNext, books, authors, bookAuthors, bookGenres, genres, userBookRatings, userOwnedEditions, editions, userBookState } from "@/db/schema";
import { eq, and, asc, isNull } from "drizzle-orm";
import { getEffectiveCoverUrl } from "@/lib/covers";
import {
  batchFetchBookAuthors,
  batchFetchUserRatings,
  batchFetchEditionCovers,
  batchFetchBookStates,
  batchFetchTopLevelGenres,
} from "@/lib/queries/batch-helpers";

export interface UpNextItem {
  id: string;
  bookId: string;
  slug: string | null;
  position: number;
  title: string;
  coverImageUrl: string | null;
  authorName: string | null;
  topLevelGenre: string | null;
  pages: number | null;
  audioLengthMinutes: number | null;
  userRating: number | null;
}

export async function getUserUpNext(userId: string): Promise<UpNextItem[]> {
  const rows = await db
    .select({
      id: upNext.id,
      bookId: upNext.bookId,
      position: upNext.position,
      title: books.title,
      slug: books.slug,
      coverImageUrl: books.coverImageUrl,
      pages: books.pages,
      audioLengthMinutes: books.audioLengthMinutes,
    })
    .from(upNext)
    .innerJoin(books, eq(upNext.bookId, books.id))
    .where(eq(upNext.userId, userId))
    .orderBy(asc(upNext.position))
    .limit(6);

  if (rows.length === 0) return [];

  // Batch fetch all related data in 5 queries instead of 5×N
  const bookIds = rows.map((r) => r.bookId);
  const [authorsMap, genresMap, ratingsMap, editionsMap, statesMap] = await Promise.all([
    batchFetchBookAuthors(bookIds),
    batchFetchTopLevelGenres(bookIds),
    batchFetchUserRatings(userId, bookIds),
    batchFetchEditionCovers(userId, bookIds),
    batchFetchBookStates(userId, bookIds),
  ]);

  return rows.map((row) => {
    const stateRow = statesMap.get(row.bookId);
    const isActivelyReading = stateRow?.state === "currently_reading" || stateRow?.state === "paused";
    const activeFormats = stateRow?.activeFormats ? JSON.parse(stateRow.activeFormats) as string[] : [];
    const ownedFormats = stateRow?.ownedFormats ? JSON.parse(stateRow.ownedFormats) as string[] : [];

    const effectiveCover = getEffectiveCoverUrl({
      baseCoverUrl: row.coverImageUrl,
      editionSelections: editionsMap.get(row.bookId) ?? [],
      activeFormats,
      ownedFormats,
      isActivelyReading,
      size: "M",
    });

    const authorNames = authorsMap.get(row.bookId) ?? [];

    return {
      ...row,
      coverImageUrl: effectiveCover,
      authorName: authorNames[0] ?? null,
      topLevelGenre: genresMap.get(row.bookId) ?? null,
      userRating: ratingsMap.get(row.bookId) ?? null,
    };
  });
}

export async function isBookInUpNext(userId: string, bookId: string): Promise<number | null> {
  const row = await db
    .select({ position: upNext.position })
    .from(upNext)
    .where(and(eq(upNext.userId, userId), eq(upNext.bookId, bookId)))
    .limit(1);
  return row[0]?.position ?? null;
}

export async function getUpNextCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: upNext.id })
    .from(upNext)
    .where(eq(upNext.userId, userId));
  return rows.length;
}
