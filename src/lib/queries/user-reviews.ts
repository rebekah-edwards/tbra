import { db } from "@/db";
import {
  userBookReviews,
  books,
  bookAuthors,
  authors,
  userBookRatings,
  userOwnedEditions,
  editions,
  userBookState,
  readingSessions,
} from "@/db/schema";
import { eq, and, desc, inArray, max, isNotNull } from "drizzle-orm";
import { getEffectiveCoverUrl } from "@/lib/covers";

export interface UserReviewWithBook {
  reviewId: string;
  bookId: string;
  bookSlug: string | null;
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

/**
 * Fetch a user's reviews with all related book data in a small, fixed
 * number of batched queries — regardless of how many reviews they have.
 *
 * Previously this function ran 4 subqueries per review (authors, rating,
 * editions, state) plus a correlated subquery on reading_sessions for
 * ordering. For a user with 10,000 reviews that produced ~40,000 SQL
 * round-trips and made /profile/reviews effectively hang. The rewrite
 * runs 6 total queries independent of review count.
 */
export async function getUserReviewsWithBooks(
  userId: string,
  limit = 5,
): Promise<UserReviewWithBook[]> {
  // 1) Core review + book rows for this user
  const reviewRows = await db
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
      audiobookCoverUrl: books.audiobookCoverUrl,
    })
    .from(userBookReviews)
    .innerJoin(books, eq(userBookReviews.bookId, books.id))
    .where(eq(userBookReviews.userId, userId))
    .orderBy(desc(userBookReviews.createdAt))
    .limit(limit)
    .all();

  if (reviewRows.length === 0) return [];

  const bookIds = reviewRows.map((r) => r.bookId);

  // 2) Latest completion date per book for this user — ONE query, not N
  const completionRows = await db
    .select({
      bookId: readingSessions.bookId,
      latestCompletion: max(readingSessions.completionDate),
    })
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        inArray(readingSessions.bookId, bookIds),
        isNotNull(readingSessions.completionDate),
      ),
    )
    .groupBy(readingSessions.bookId)
    .all();

  const completionByBook = new Map<string, string>();
  for (const row of completionRows) {
    if (row.latestCompletion) completionByBook.set(row.bookId, row.latestCompletion);
  }

  // 3) All authors for these books in one query
  const authorRows = await db
    .select({
      bookId: bookAuthors.bookId,
      name: authors.name,
    })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(inArray(bookAuthors.bookId, bookIds))
    .all();

  const authorsByBook = new Map<string, string[]>();
  for (const row of authorRows) {
    const list = authorsByBook.get(row.bookId);
    if (list) list.push(row.name);
    else authorsByBook.set(row.bookId, [row.name]);
  }

  // 4) All of this user's ratings for these books in one query
  const ratingRows = await db
    .select({
      bookId: userBookRatings.bookId,
      rating: userBookRatings.rating,
    })
    .from(userBookRatings)
    .where(
      and(
        eq(userBookRatings.userId, userId),
        inArray(userBookRatings.bookId, bookIds),
      ),
    )
    .all();

  const ratingByBook = new Map<string, number>();
  for (const row of ratingRows) ratingByBook.set(row.bookId, row.rating);

  // 5) All owned editions for this user across these books
  const editionRows = await db
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
        inArray(userOwnedEditions.bookId, bookIds),
      ),
    )
    .all();

  const editionsByBook = new Map<string, { coverId: number | null; format: string | null }[]>();
  for (const row of editionRows) {
    const list = editionsByBook.get(row.bookId);
    const entry = { coverId: row.coverId ?? null, format: row.format ?? null };
    if (list) list.push(entry);
    else editionsByBook.set(row.bookId, [entry]);
  }

  // 6) Reading state + owned/active formats for each book
  const stateRows = await db
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
        inArray(userBookState.bookId, bookIds),
      ),
    )
    .all();

  const stateByBook = new Map<string, (typeof stateRows)[number]>();
  for (const row of stateRows) stateByBook.set(row.bookId, row);

  // Assemble and re-sort by latest completion date (most recent first,
  // reviews with no completion date fall back to createdAt).
  const result: UserReviewWithBook[] = reviewRows.map((review) => {
    const stateRow = stateByBook.get(review.bookId);
    const isActivelyReading =
      stateRow?.state === "currently_reading" || stateRow?.state === "paused";
    const activeFormats = stateRow?.activeFormats
      ? (JSON.parse(stateRow.activeFormats) as string[])
      : [];
    const ownedFormats = stateRow?.ownedFormats
      ? (JSON.parse(stateRow.ownedFormats) as string[])
      : [];

    const effectiveCover = getEffectiveCoverUrl({
      baseCoverUrl: review.coverImageUrl,
      audiobookCoverUrl: review.audiobookCoverUrl,
      editionSelections: editionsByBook.get(review.bookId) ?? [],
      activeFormats,
      ownedFormats,
      isActivelyReading,
      size: "M",
    });

    return {
      reviewId: review.reviewId,
      bookId: review.bookId,
      bookSlug: review.bookSlug ?? null,
      title: review.title,
      coverImageUrl: effectiveCover,
      authors: authorsByBook.get(review.bookId) ?? [],
      rating: ratingByBook.get(review.bookId) ?? null,
      reviewText: review.reviewText,
      didNotFinish: review.didNotFinish ?? false,
      dnfPercentComplete: review.dnfPercentComplete ?? null,
      isAnonymous: review.isAnonymous ?? false,
      createdAt: review.createdAt,
    };
  });

  // Sort by most recent completion date (null completions sort to the bottom
  // but preserve createdAt desc among themselves — reviewRows already comes
  // back ordered by createdAt desc).
  result.sort((a, b) => {
    const ac = completionByBook.get(a.bookId) ?? "";
    const bc = completionByBook.get(b.bookId) ?? "";
    if (ac && bc) return ac < bc ? 1 : ac > bc ? -1 : 0;
    if (ac) return -1;
    if (bc) return 1;
    // Both null — preserve createdAt desc (already in that order from SQL)
    return 0;
  });

  return result;
}
