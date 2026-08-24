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
import { eq, and, inArray, sql } from "drizzle-orm";
import { getCurrentUser, clearSessionCookie } from "@/lib/auth";
import { recordAccountDeletion } from "@/lib/account/deletion-audit";
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
    // Look up avatar + audit fields before deletion
    const userRecord = await db
      .select({
        avatarUrl: users.avatarUrl,
        email: users.email,
        username: users.username,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, user.userId))
      .get();

    // Audit BEFORE the cascade — the row has to outlive the user record.
    await recordAccountDeletion({
      userId: user.userId,
      email: userRecord?.email ?? null,
      username: userRecord?.username ?? null,
      source: "web",
      accountCreatedAt: userRecord?.createdAt ?? null,
    });

    await deleteAllUserData(user.userId);
    // Every REMAINING table with a users FK (2026-07-16) — without these the
    // users DELETE throws SQLITE_CONSTRAINT_FOREIGNKEY and account deletion
    // silently failed for any user with prefs/follows/shelves. Kept in sync
    // with /api/v1/settings/danger.
    const uid = user.userId;
    await db.run(sql`DELETE FROM buddy_read_messages WHERE user_id = ${uid} OR buddy_read_id IN (SELECT id FROM buddy_reads WHERE created_by = ${uid})`);
    await db.run(sql`DELETE FROM buddy_read_members WHERE user_id = ${uid} OR buddy_read_id IN (SELECT id FROM buddy_reads WHERE created_by = ${uid})`);
    await db.run(sql`DELETE FROM buddy_reads WHERE created_by = ${uid}`);
    await db.run(sql`DELETE FROM shelf_follows WHERE user_id = ${uid} OR shelf_id IN (SELECT id FROM shelves WHERE user_id = ${uid})`);
    await db.run(sql`DELETE FROM shelf_books WHERE shelf_id IN (SELECT id FROM shelves WHERE user_id = ${uid})`);
    await db.run(sql`DELETE FROM shelves WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM user_follows WHERE follower_id = ${uid} OR followed_id = ${uid}`);
    await db.run(sql`DELETE FROM author_follows WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM tbr_notes WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM user_hidden_books WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM user_genre_preferences WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM user_content_preferences WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM user_reading_preferences WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM user_notification_preferences WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM user_notifications WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM user_previous_usernames WHERE user_id = ${uid}`);
    // discover_usage has no FK to users, so omitting it never threw — it just
    // silently left an orphan row keyed to a deleted user's id (2026-08-24).
    await db.run(sql`DELETE FROM discover_usage WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM reported_issues WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM auth_refresh_tokens WHERE user_id = ${uid}`);
    await db.run(sql`DELETE FROM password_reset_tokens WHERE user_id = ${uid}`);
    await db.run(sql`UPDATE users SET referred_by_user_id = NULL WHERE referred_by_user_id = ${uid}`);
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
