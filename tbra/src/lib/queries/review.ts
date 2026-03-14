import { db } from "@/db";
import {
  userBookReviews,
  userBookDimensionRatings,
  reviewDescriptorTags,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

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
