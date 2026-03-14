import { db } from "@/db";
import { userBookState, books, bookAuthors, authors, userBookRatings, userOwnedEditions, editions } from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { buildCoverUrl } from "@/lib/openlibrary";

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
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  state: string | null;
  ownedFormats: string[];
  isFiction: boolean | null;
  userRating: number | null;
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
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      isFiction: books.isFiction,
    })
    .from(userBookState)
    .innerJoin(books, eq(userBookState.bookId, books.id))
    .where(eq(userBookState.userId, userId))
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

  const result: UserBookWithDetails[] = [];
  for (const row of rows) {
    const bookAuthorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, row.bookId))
      .all();

    // Get user's rating for this book
    const ratingRow = await db
      .select({ rating: userBookRatings.rating })
      .from(userBookRatings)
      .where(
        and(
          eq(userBookRatings.userId, userId),
          eq(userBookRatings.bookId, row.bookId)
        )
      )
      .get();

    // Get effective cover: check for owned edition covers first
    let effectiveCover = row.coverImageUrl;
    const editionRows = await db
      .select({ coverId: editions.coverId })
      .from(userOwnedEditions)
      .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
      .where(
        and(
          eq(userOwnedEditions.userId, userId),
          eq(userOwnedEditions.bookId, row.bookId)
        )
      )
      .all();

    for (const ed of editionRows) {
      if (ed.coverId) {
        const edCover = buildCoverUrl(ed.coverId, "M");
        if (edCover) {
          effectiveCover = edCover;
          break;
        }
      }
    }

    result.push({
      id: row.bookId,
      title: row.title,
      coverImageUrl: effectiveCover,
      authors: bookAuthorRows.map((a) => a.name),
      state: row.state,
      ownedFormats: row.ownedFormats ? (JSON.parse(row.ownedFormats) as string[]) : [],
      isFiction: row.isFiction ?? null,
      userRating: ratingRow?.rating ?? null,
    });
  }

  return result;
}
