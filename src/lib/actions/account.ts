"use server";

import { db } from "@/db";
import {
  users,
  userBookState,
  readingSessions,
  userBookRatings,
  userOwnedEditions,
  userBookReviews,
  reviewDescriptorTags,
  userBookDimensionRatings,
  reviewHelpfulVotes,
  upNext,
  userFavoriteBooks,
  readingGoals,
  readingNotes,
  reportCorrections,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getCurrentUser, clearSessionCookie } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { unlink } from "fs/promises";
import path from "path";

type ActionResult = { success: boolean; error?: string };

/**
 * Delete all user library data in FK-safe order.
 * Shared by resetLibrary and deleteAccount.
 */
async function deleteAllUserData(userId: string) {
  // 1-4: Children of userBookReviews (need subquery since they reference review_id, not user_id)
  const userReviewIds = await db
    .select({ id: userBookReviews.id })
    .from(userBookReviews)
    .where(eq(userBookReviews.userId, userId))
    .all();
  const reviewIds = userReviewIds.map((r) => r.id);
  if (reviewIds.length > 0) {
    await db.delete(reviewDescriptorTags).where(inArray(reviewDescriptorTags.reviewId, reviewIds)).run();
    await db.delete(userBookDimensionRatings).where(inArray(userBookDimensionRatings.reviewId, reviewIds)).run();
    await db.delete(reviewHelpfulVotes).where(inArray(reviewHelpfulVotes.reviewId, reviewIds)).run();
  }
  await db.delete(reviewHelpfulVotes).where(eq(reviewHelpfulVotes.userId, userId)).run();

  // 5-14: Direct user-scoped tables
  await db.delete(userBookReviews).where(eq(userBookReviews.userId, userId)).run();
  await db.delete(readingNotes).where(eq(readingNotes.userId, userId)).run();
  await db.delete(readingSessions).where(eq(readingSessions.userId, userId)).run();
  await db.delete(userBookRatings).where(eq(userBookRatings.userId, userId)).run();
  await db.delete(userOwnedEditions).where(eq(userOwnedEditions.userId, userId)).run();
  await db.delete(upNext).where(eq(upNext.userId, userId)).run();
  await db.delete(userFavoriteBooks).where(eq(userFavoriteBooks.userId, userId)).run();
  await db.delete(readingGoals).where(eq(readingGoals.userId, userId)).run();
  await db.delete(reportCorrections).where(eq(reportCorrections.userId, userId)).run();
  await db.delete(userBookState).where(eq(userBookState.userId, userId)).run();
}

/**
 * Reset library — deletes all user book data but keeps the account.
 */
export async function resetLibrary(confirmPhrase: string): Promise<ActionResult> {
  if (confirmPhrase !== "reset my library") {
    return { success: false, error: "Confirmation phrase does not match" };
  }

  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  try {
    await deleteAllUserData(user.userId);

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[account] Reset library error:", err);
    return { success: false, error: "Failed to reset library" };
  }
}

/**
 * Delete account — deletes all data + user record + avatar, clears session.
 */
export async function deleteAccount(confirmPhrase: string): Promise<ActionResult> {
  if (confirmPhrase !== "delete my account") {
    return { success: false, error: "Confirmation phrase does not match" };
  }

  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  try {
    // Look up avatar before deletion
    const userRecord = await db
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, user.userId))
      .get();

    await deleteAllUserData(user.userId);
    await db.delete(users).where(eq(users.id, user.userId)).run();

    // Delete avatar file from disk
    if (userRecord?.avatarUrl) {
      const avatarPath = path.join(process.cwd(), "public", userRecord.avatarUrl);
      try {
        await unlink(avatarPath);
      } catch {
        // File may not exist
      }
    }

    await clearSessionCookie();
    return { success: true };
  } catch (err) {
    console.error("[account] Delete account error:", err);
    return { success: false, error: "Failed to delete account" };
  }
}

/**
 * Delete TBR pile — removes TBR books and Up Next queue.
 */
export async function deleteTbrPile(confirmPhrase: string): Promise<ActionResult> {
  if (confirmPhrase !== "delete tbr") {
    return { success: false, error: "Confirmation phrase does not match" };
  }

  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  try {
    await db.delete(upNext).where(eq(upNext.userId, user.userId)).run();
    await db.delete(userBookState)
      .where(and(eq(userBookState.userId, user.userId), eq(userBookState.state, "tbr")))
      .run();

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[account] Delete TBR error:", err);
    return { success: false, error: "Failed to delete TBR pile" };
  }
}

/**
 * Delete owned books — clears owned editions and format data.
 */
export async function deleteOwnedBooks(confirmPhrase: string): Promise<ActionResult> {
  if (confirmPhrase !== "delete owned") {
    return { success: false, error: "Confirmation phrase does not match" };
  }

  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  try {
    await db.delete(userOwnedEditions).where(eq(userOwnedEditions.userId, user.userId)).run();
    await db.update(userBookState)
      .set({ ownedFormats: null })
      .where(eq(userBookState.userId, user.userId))
      .run();

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("[account] Delete owned error:", err);
    return { success: false, error: "Failed to delete owned books" };
  }
}
