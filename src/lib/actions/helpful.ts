"use server";

import { db } from "@/db";
import { reviewHelpfulVotes, userBookReviews, userNotifications, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function toggleHelpfulVote(reviewId: string, bookId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "Must be logged in to vote" };
  }

  // Check if the user already voted
  const existing = await db
    .select()
    .from(reviewHelpfulVotes)
    .where(
      and(
        eq(reviewHelpfulVotes.userId, user.userId),
        eq(reviewHelpfulVotes.reviewId, reviewId)
      )
    )
    .get();

  if (existing) {
    // Remove vote
    await db
      .delete(reviewHelpfulVotes)
      .where(eq(reviewHelpfulVotes.id, existing.id));
  } else {
    // Add vote
    await db.insert(reviewHelpfulVotes).values({
      userId: user.userId,
      reviewId,
    });

    // Notify review author (only on add, not remove)
    try {
      const review = await db.select({ userId: userBookReviews.userId })
        .from(userBookReviews).where(eq(userBookReviews.id, reviewId)).get();
      if (review && review.userId !== user.userId) {
        const voter = await db.select({ displayName: users.displayName, username: users.username })
          .from(users).where(eq(users.id, user.userId)).get();
        const voterName = voter?.displayName || voter?.username || "Someone";
        await db.insert(userNotifications).values({
          userId: review.userId,
          type: "review_helpful",
          title: "Review marked helpful",
          message: `${voterName} found your review helpful`,
        });
      }
    } catch {
      // Don't break the vote if notification fails
    }
  }

  revalidatePath(`/book/${bookId}/reviews`);
  return { voted: !existing };
}
