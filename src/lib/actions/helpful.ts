"use server";

import { db } from "@/db";
import { reviewHelpfulVotes, userBookReviews, userNotifications, users, books } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function toggleHelpfulVote(reviewId: string, bookId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "Must be logged in to vote" };
  }
  return toggleHelpfulVoteFor(userId, reviewId, bookId);
}

/** Core toggle, callable with an explicit user id (used by /api/v1). */
export async function toggleHelpfulVoteFor(userId: string, reviewId: string, bookId: string) {
  // Check if the user already voted
  const existing = await db
    .select()
    .from(reviewHelpfulVotes)
    .where(
      and(
        eq(reviewHelpfulVotes.userId, userId),
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
      userId: userId,
      reviewId,
    });

    // Notify review author (only on add, not remove)
    try {
      const review = await db.select({ userId: userBookReviews.userId })
        .from(userBookReviews).where(eq(userBookReviews.id, reviewId)).get();
      if (review && review.userId !== userId) {
        const voter = await db.select({ displayName: users.displayName, username: users.username })
          .from(users).where(eq(users.id, userId)).get();
        const voterName = voter?.displayName || voter?.username || "Someone";
        const bookRow = await db.select({ slug: books.slug }).from(books).where(eq(books.id, bookId)).get();
        await db.insert(userNotifications).values({
          userId: review.userId,
          type: "review_helpful",
          title: "Review marked helpful",
          message: `${voterName} found your review helpful`,
          linkUrl: bookRow?.slug ? `/book/${bookRow.slug}/reviews` : `/book/${bookId}/reviews`,
        });
      }
    } catch {
      // Don't break the vote if notification fails
    }
  }

  revalidatePath(`/book/${bookId}/reviews`);
  return { voted: !existing };
}
