import { db } from "@/db";
import {
  userBookReviews,
  reviewDescriptorTags,
  reviewHelpfulVotes,
  users,
} from "@/db/schema";
import { eq, and, ne, desc, sql, count, isNotNull } from "drizzle-orm";
import { stripHtml, truncate } from "@/lib/text-utils";
import { MOODS } from "@/lib/review-constants";

export interface CompactReview {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  isAnonymous: boolean;
  overallRating: number | null;
  reviewTextPlain: string;
  helpfulCount: number;
}

export interface ReviewSummaryData {
  topReviews: CompactReview[];
  totalReviewCount: number;
  summaryText: string | null;
}

/** Map dimension keys to human-friendly noun + verb for summary text */
const DIMENSION_PHRASES: Record<string, { noun: string; verb: string }> = {
  characters: { noun: "characters", verb: "are" },
  plot: { noun: "plot", verb: "is" },
  setting: { noun: "setting", verb: "is" },
  prose: { noun: "writing", verb: "is" },
};

export async function getBookReviewSummaryData(
  bookId: string
): Promise<ReviewSummaryData | null> {
  // 1. Get all review IDs + moods for this book
  const allReviews = await db
    .select({
      id: userBookReviews.id,
      mood: userBookReviews.mood,
    })
    .from(userBookReviews)
    .where(eq(userBookReviews.bookId, bookId))
    .all();

  const totalReviewCount = allReviews.length;
  if (totalReviewCount === 0) return null;

  const reviewIds = allReviews.map((r) => r.id);

  // 2. Tags grouped by dimension (exclude content_details)
  const tagRows = await db
    .select({
      dimension: reviewDescriptorTags.dimension,
      tag: reviewDescriptorTags.tag,
      tagCount: count(reviewDescriptorTags.id),
    })
    .from(reviewDescriptorTags)
    .where(
      and(
        sql`${reviewDescriptorTags.reviewId} IN (${sql.join(
          reviewIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        ne(reviewDescriptorTags.dimension, "content_details")
      )
    )
    .groupBy(reviewDescriptorTags.dimension, reviewDescriptorTags.tag)
    .orderBy(desc(count(reviewDescriptorTags.id)))
    .all();

  // Group top tags per dimension
  const tagsByDimension = new Map<string, string[]>();
  for (const row of tagRows) {
    const existing = tagsByDimension.get(row.dimension) ?? [];
    if (existing.length < 2) {
      existing.push(row.tag.toLowerCase());
      tagsByDimension.set(row.dimension, existing);
    }
  }

  // 3. Top 3 reviews by helpful count (must have review text)
  const helpfulCounts = await db
    .select({
      reviewId: reviewHelpfulVotes.reviewId,
      helpfulCount: count(reviewHelpfulVotes.id),
    })
    .from(reviewHelpfulVotes)
    .where(
      sql`${reviewHelpfulVotes.reviewId} IN (${sql.join(
        reviewIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    )
    .groupBy(reviewHelpfulVotes.reviewId)
    .all();

  const helpfulMap = new Map(
    helpfulCounts.map((r) => [r.reviewId, r.helpfulCount])
  );

  const reviewsWithText = await db
    .select({
      id: userBookReviews.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      isAnonymous: userBookReviews.isAnonymous,
      overallRating: userBookReviews.overallRating,
      reviewText: userBookReviews.reviewText,
    })
    .from(userBookReviews)
    .innerJoin(users, eq(users.id, userBookReviews.userId))
    .where(
      and(
        eq(userBookReviews.bookId, bookId),
        isNotNull(userBookReviews.reviewText)
      )
    )
    .all();

  const topReviews: CompactReview[] = reviewsWithText
    .filter((r) => r.reviewText && r.reviewText.trim() !== "")
    .map((r) => ({
      id: r.id,
      displayName: r.isAnonymous ? null : r.displayName,
      avatarUrl: r.isAnonymous ? null : r.avatarUrl,
      isAnonymous: r.isAnonymous,
      overallRating: r.overallRating,
      reviewTextPlain: truncate(stripHtml(r.reviewText!), 150),
      helpfulCount: helpfulMap.get(r.id) ?? 0,
    }))
    .sort((a, b) => b.helpfulCount - a.helpfulCount)
    .slice(0, 3);

  // 4. Build context-aware summary text
  const summaryText = buildSummaryText(tagsByDimension, allReviews);

  return {
    topReviews,
    totalReviewCount,
    summaryText,
  };
}

function buildSummaryText(
  tagsByDimension: Map<string, string[]>,
  reviews: { mood: string | null }[]
): string | null {
  const parts: string[] = [];

  // Dimension-specific phrases: "the characters are lovable and relatable"
  for (const [dimKey, dim] of Object.entries(DIMENSION_PHRASES)) {
    const tags = tagsByDimension.get(dimKey);
    if (tags && tags.length > 0) {
      const tagStr = tags.join(" and ");
      parts.push(`the ${dim.noun} ${dim.verb} ${tagStr}`);
    }
  }

  // Mood summary: find the most common mood
  const moodCounts = new Map<string, number>();
  for (const r of reviews) {
    if (r.mood) {
      moodCounts.set(r.mood, (moodCounts.get(r.mood) ?? 0) + 1);
    }
  }

  if (parts.length === 0 && moodCounts.size === 0) return null;

  let text = "";
  if (parts.length > 0) {
    const lastPart = parts.pop();
    text =
      parts.length > 0
        ? `Readers say ${parts.join(", ")}, and ${lastPart}.`
        : `Readers say ${lastPart}.`;
  }

  if (moodCounts.size > 0) {
    const topMood = [...moodCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const moodInfo = MOODS.find((m) => m.key === topMood[0]);
    if (moodInfo) {
      const moodPhrase = `Most felt ${moodInfo.label.toLowerCase()} after reading.`;
      text = text ? `${text} ${moodPhrase}` : moodPhrase;
    }
  }

  return text || null;
}
