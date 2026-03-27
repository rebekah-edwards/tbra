import { db } from "@/db";
import { userBookReviews, books, bookAuthors, authors, userBookRatings, userOwnedEditions, editions, userBookState, readingSessions } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getEffectiveCoverUrl } from "@/lib/covers";

export interface UserReviewWithBook {
  reviewId: string;
  bookId: string;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  rating: number | null;
  reviewText: string | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  isAnonymous: boolean;
  createdAt: string;
}

export async function getUserReviewsWithBooks(
  userId: string,
  limit = 5
): Promise<UserReviewWithBook[]> {
  const reviews = await db
    .select({
      reviewId: userBookReviews.id,
      bookId: userBookReviews.bookId,
      bookSlug: books.slug,
      reviewText: userBookReviews.reviewText,
      didNotFinish: userBookReviews.didNotFinish,
      dnfPercentComplete: userBookReviews.dnfPercentComplete,
      isAnonymous: userBookReviews.isAnonymous,
      createdAt: userBookReviews.createdAt,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
    })
    .from(userBookReviews)
    .innerJoin(books, eq(userBookReviews.bookId, books.id))
    .where(
      eq(userBookReviews.userId, userId)
    )
    .orderBy(
      // Sort by completion date (most recent first), null dates last
      sql`COALESCE((
        SELECT rs.completion_date FROM reading_sessions rs
        WHERE rs.user_id = ${userBookReviews.userId}
        AND rs.book_id = ${userBookReviews.bookId}
        AND rs.completion_date IS NOT NULL
        ORDER BY rs.completion_date DESC LIMIT 1
      ), '0000-00-00') DESC`,
      desc(userBookReviews.createdAt)
    )
    .limit(limit)
    .all();

  const result: UserReviewWithBook[] = [];
  for (const review of reviews) {
    const authorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, review.bookId))
      .all();

    const ratingRow = await db
      .select({ rating: userBookRatings.rating })
      .from(userBookRatings)
      .where(and(eq(userBookRatings.userId, userId), eq(userBookRatings.bookId, review.bookId)))
      .get();

    // Edition cover cascade
    const editionRows = await db
      .select({ coverId: editions.coverId, format: userOwnedEditions.format })
      .from(userOwnedEditions)
      .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
      .where(and(eq(userOwnedEditions.userId, userId), eq(userOwnedEditions.bookId, review.bookId)))
      .all();

    const stateRow = await db
      .select({ state: userBookState.state, ownedFormats: userBookState.ownedFormats, activeFormats: userBookState.activeFormats })
      .from(userBookState)
      .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, review.bookId)))
      .get();

    const isActivelyReading = stateRow?.state === "currently_reading" || stateRow?.state === "paused";
    const activeFormats = stateRow?.activeFormats ? JSON.parse(stateRow.activeFormats) as string[] : [];
    const ownedFormats = stateRow?.ownedFormats ? JSON.parse(stateRow.ownedFormats) as string[] : [];

    const effectiveCover = getEffectiveCoverUrl({
      baseCoverUrl: review.coverImageUrl,
      editionSelections: editionRows,
      activeFormats,
      ownedFormats,
      isActivelyReading,
      size: "M",
    });

    result.push({
      reviewId: review.reviewId,
      bookId: review.bookId,
      title: review.title,
      coverImageUrl: effectiveCover,
      authors: authorRows.map((a) => a.name),
      rating: ratingRow?.rating ?? null,
      reviewText: review.reviewText,
      didNotFinish: review.didNotFinish ?? false,
      dnfPercentComplete: review.dnfPercentComplete ?? null,
      isAnonymous: review.isAnonymous ?? false,
      createdAt: review.createdAt,
    });
  }

  return result;
}
