import { db } from "@/db";
import { userBookState, books, bookAuthors, authors, userBookRatings, userOwnedEditions, editions } from "@/db/schema";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { getEffectiveCoverUrl } from "@/lib/covers";
import {
  batchFetchBookAuthors,
  batchFetchUserRatings,
  batchFetchEditionCovers,
  batchFetchBookGenres,
  batchFetchCompletionYears,
  batchFetchBookContentRatings,
} from "@/lib/queries/batch-helpers";
import { getTbrNotesForBooks } from "@/lib/queries/tbr-notes";

export interface UserBookState {
  state: string | null;
  ownedFormats: string[];
  activeFormats: string[];
}

export async function getUserBookState(userId: string, bookId: string): Promise<UserBookState | null> {
  const row = await db
    .select({
      state: userBookState.state,
      ownedFormats: userBookState.ownedFormats,
      activeFormats: userBookState.activeFormats,
    })
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, userId),
        eq(userBookState.bookId, bookId)
      )
    )
    .get();

  if (!row) return null;

  return {
    state: row.state,
    ownedFormats: row.ownedFormats ? (JSON.parse(row.ownedFormats) as string[]) : [],
    activeFormats: row.activeFormats ? (JSON.parse(row.activeFormats) as string[]) : [],
  };
}

export interface UserBookWithDetails {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  state: string | null;
  ownedFormats: string[];
  activeFormats: string[];
  isFiction: boolean | null;
  userRating: number | null;
  updatedAt: string | null;
  genres: string[];
  completionYear: number | null;
  contentRatings: { categoryId: string; intensity: number }[];
  tbrNote?: string | null;
}

export async function getUserBooks(
  userId: string,
  options?: { state?: string; ownedOnly?: boolean; limit?: number }
): Promise<UserBookWithDetails[]> {
  let query = db
    .select({
      bookId: userBookState.bookId,
      state: userBookState.state,
      ownedFormats: userBookState.ownedFormats,
      activeFormats: userBookState.activeFormats,
      updatedAt: userBookState.updatedAt,
      title: books.title,
      slug: books.slug,
      coverImageUrl: books.coverImageUrl,
      isFiction: books.isFiction,
    })
    .from(userBookState)
    .innerJoin(books, eq(userBookState.bookId, books.id))
    .where(eq(userBookState.userId, userId))
    .orderBy(desc(userBookState.updatedAt))
    .$dynamic();

  if (options?.state) {
    query = query.where(
      and(
        eq(userBookState.userId, userId),
        eq(userBookState.state, options.state)
      )
    );
  }

  if (options?.ownedOnly) {
    query = query.where(
      and(
        eq(userBookState.userId, userId),
        isNotNull(userBookState.ownedFormats)
      )
    );
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const rows = await query.all();
  if (rows.length === 0) return [];

  // Batch fetch all related data in 5 queries instead of N×per-book
  const bookIds = rows.map((r) => r.bookId);
  // Collect TBR book IDs for note batch loading
  const tbrBookIds = rows.filter((r) => r.state === "tbr").map((r) => r.bookId);

  const [authorsMap, ratingsMap, editionsMap, genresMap, completionYearsMap, contentRatingsMap, tbrNotesMap] = await Promise.all([
    batchFetchBookAuthors(bookIds),
    batchFetchUserRatings(userId, bookIds),
    batchFetchEditionCovers(userId, bookIds),
    batchFetchBookGenres(bookIds),
    batchFetchCompletionYears(userId, bookIds),
    batchFetchBookContentRatings(bookIds),
    tbrBookIds.length > 0 ? getTbrNotesForBooks(userId, tbrBookIds) : Promise.resolve(new Map<string, string>()),
  ]);

  return rows.map((row) => {
    const parsedOwned = row.ownedFormats ? (JSON.parse(row.ownedFormats) as string[]) : [];
    const activeFormats = row.activeFormats ? (JSON.parse(row.activeFormats) as string[]) : [];
    const isActivelyReading = row.state === "currently_reading" || row.state === "paused";

    const effectiveCover = getEffectiveCoverUrl({
      baseCoverUrl: row.coverImageUrl,
      editionSelections: editionsMap.get(row.bookId) ?? [],
      activeFormats,
      ownedFormats: parsedOwned,
      isActivelyReading,
      size: "M",
    });

    return {
      id: row.bookId,
      slug: row.slug ?? null,
      title: row.title,
      coverImageUrl: effectiveCover,
      authors: authorsMap.get(row.bookId) ?? [],
      state: row.state,
      ownedFormats: parsedOwned,
      activeFormats,
      isFiction: row.isFiction ?? null,
      userRating: ratingsMap.get(row.bookId) ?? null,
      updatedAt: row.updatedAt ?? null,
      genres: genresMap.get(row.bookId) ?? [],
      completionYear: completionYearsMap.get(row.bookId) ?? null,
      contentRatings: contentRatingsMap.get(row.bookId) ?? [],
      tbrNote: row.state === "tbr" ? (tbrNotesMap.get(row.bookId) ?? null) : null,
    };
  });
}
