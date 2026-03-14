import { db } from "@/db";
import {
  userBookReviews,
  userBookDimensionRatings,
  reviewDescriptorTags,
  reviewHelpfulVotes,
  users,
} from "@/db/schema";
import { eq, and, inArray, desc, sql, count } from "drizzle-orm";

export interface UserReview {
  id: string;
  overallRating: number | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  reviewText: string | null;
  mood: string | null;
  moodIntensity: number | null;
  dimensionRatings: Record<string, number | null>;
  dimensionTags: Record<string, string[]>;
}

export async function getUserReview(
  userId: string,
  bookId: string
): Promise<UserReview | null> {
  const review = await db
    .select()
    .from(userBookReviews)
    .where(
      and(
        eq(userBookReviews.userId, userId),
        eq(userBookReviews.bookId, bookId)
      )
    )
    .get();

  if (!review) return null;

  // Fetch dimension ratings
  const dimRows = await db
    .select({
      dimension: userBookDimensionRatings.dimension,
      rating: userBookDimensionRatings.rating,
    })
    .from(userBookDimensionRatings)
    .where(eq(userBookDimensionRatings.reviewId, review.id))
    .all();

  const dimensionRatings: Record<string, number | null> = {};
  for (const row of dimRows) {
    dimensionRatings[row.dimension] = row.rating;
  }

  // Fetch descriptor tags
  const tagRows = await db
    .select({
      dimension: reviewDescriptorTags.dimension,
      tag: reviewDescriptorTags.tag,
    })
    .from(reviewDescriptorTags)
    .where(eq(reviewDescriptorTags.reviewId, review.id))
    .all();

  const dimensionTags: Record<string, string[]> = {};
  for (const row of tagRows) {
    if (!dimensionTags[row.dimension]) dimensionTags[row.dimension] = [];
    dimensionTags[row.dimension].push(row.tag);
  }

  return {
    id: review.id,
    overallRating: review.overallRating,
    didNotFinish: review.didNotFinish,
    dnfPercentComplete: review.dnfPercentComplete ?? null,
    reviewText: review.reviewText ?? null,
    mood: review.mood,
    moodIntensity: review.moodIntensity,
    dimensionRatings,
    dimensionTags,
  };
}

// ─── All reviews for a book ───

export interface BookReviewEntry {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  overallRating: number | null;
  mood: string | null;
  moodIntensity: number | null;
  reviewText: string | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  createdAt: string;
  dimensionRatings: Record<string, number | null>;
  dimensionTags: Record<string, string[]>;
  helpfulCount: number;
  currentUserVoted: boolean;
}

export async function getBookReviews(bookId: string, currentUserId?: string | null): Promise<BookReviewEntry[]> {
  // Fetch all reviews for this book joined with user info
  const rows = await db
    .select({
      id: userBookReviews.id,
      userId: userBookReviews.userId,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      overallRating: userBookReviews.overallRating,
      mood: userBookReviews.mood,
      moodIntensity: userBookReviews.moodIntensity,
      reviewText: userBookReviews.reviewText,
      didNotFinish: userBookReviews.didNotFinish,
      dnfPercentComplete: userBookReviews.dnfPercentComplete,
      createdAt: userBookReviews.createdAt,
    })
    .from(userBookReviews)
    .innerJoin(users, eq(userBookReviews.userId, users.id))
    .where(eq(userBookReviews.bookId, bookId))
    .orderBy(desc(userBookReviews.createdAt))
    .all();

  if (rows.length === 0) return [];

  const reviewIds = rows.map((r) => r.id);

  // Batch-fetch dimension ratings
  const dimRows = await db
    .select({
      reviewId: userBookDimensionRatings.reviewId,
      dimension: userBookDimensionRatings.dimension,
      rating: userBookDimensionRatings.rating,
    })
    .from(userBookDimensionRatings)
    .where(inArray(userBookDimensionRatings.reviewId, reviewIds))
    .all();

  // Batch-fetch tags
  const tagRows = await db
    .select({
      reviewId: reviewDescriptorTags.reviewId,
      dimension: reviewDescriptorTags.dimension,
      tag: reviewDescriptorTags.tag,
    })
    .from(reviewDescriptorTags)
    .where(inArray(reviewDescriptorTags.reviewId, reviewIds))
    .all();

  // Batch-fetch helpful vote counts
  const helpfulRows = await db
    .select({
      reviewId: reviewHelpfulVotes.reviewId,
      count: count(),
    })
    .from(reviewHelpfulVotes)
    .where(inArray(reviewHelpfulVotes.reviewId, reviewIds))
    .groupBy(reviewHelpfulVotes.reviewId)
    .all();

  const helpfulMap = new Map<string, number>();
  for (const row of helpfulRows) {
    helpfulMap.set(row.reviewId, row.count);
  }

  // Check which reviews the current user has voted on
  const userVotedSet = new Set<string>();
  if (currentUserId) {
    const userVotes = await db
      .select({ reviewId: reviewHelpfulVotes.reviewId })
      .from(reviewHelpfulVotes)
      .where(
        and(
          eq(reviewHelpfulVotes.userId, currentUserId),
          inArray(reviewHelpfulVotes.reviewId, reviewIds)
        )
      )
      .all();
    for (const v of userVotes) {
      userVotedSet.add(v.reviewId);
    }
  }

  // Index by reviewId
  const dimMap = new Map<string, Record<string, number | null>>();
  for (const row of dimRows) {
    if (!dimMap.has(row.reviewId)) dimMap.set(row.reviewId, {});
    dimMap.get(row.reviewId)![row.dimension] = row.rating;
  }

  const tagMap = new Map<string, Record<string, string[]>>();
  for (const row of tagRows) {
    if (!tagMap.has(row.reviewId)) tagMap.set(row.reviewId, {});
    const dims = tagMap.get(row.reviewId)!;
    if (!dims[row.dimension]) dims[row.dimension] = [];
    dims[row.dimension].push(row.tag);
  }

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    overallRating: row.overallRating,
    mood: row.mood,
    moodIntensity: row.moodIntensity,
    reviewText: row.reviewText ?? null,
    didNotFinish: row.didNotFinish,
    dnfPercentComplete: row.dnfPercentComplete ?? null,
    createdAt: row.createdAt,
    dimensionRatings: dimMap.get(row.id) ?? {},
    dimensionTags: tagMap.get(row.id) ?? {},
    helpfulCount: helpfulMap.get(row.id) ?? 0,
    currentUserVoted: userVotedSet.has(row.id),
  }));
}
