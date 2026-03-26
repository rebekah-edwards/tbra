"use server";

import { db } from "@/db";
import { reviewHelpfulVotes } from "@/db/schema";
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
  }

  revalidatePath(`/book/${bookId}/reviews`);
  return { voted: !existing };
}
