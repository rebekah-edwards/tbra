import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { db } from "@/db";
import {
  users, userBookState, userBookRatings, userBookReviews,
  userBookDimensionRatings, reviewDescriptorTags, reviewHelpfulVotes,
  readingNotes, readingSessions, userOwnedEditions, upNext,
  userFavoriteBooks, readingGoals, reportCorrections,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

// Bearer twin of the web Danger Zone actions (src/lib/actions/account.ts) —
// SAME type-to-confirm phrases, re-checked server-side (case-insensitive),
// same deletion scopes. Keep the two in sync if scopes ever change.
const PHRASES: Record<string, string> = {
  "reset-library": "reset my library",
  "delete-account": "delete my account",
  "delete-tbr": "delete tbr",
  "delete-owned": "delete owned",
};

/** Mirror of account.ts deleteAllUserData — full user-activity wipe. */
async function deleteAllUserData(userId: string) {
  const reviewIds = (await db.select({ id: userBookReviews.id })
    .from(userBookReviews).where(eq(userBookReviews.userId, userId)).all()).map((r) => r.id);
  if (reviewIds.length > 0) {
    await db.delete(reviewDescriptorTags).where(inArray(reviewDescriptorTags.reviewId, reviewIds));
    await db.delete(userBookDimensionRatings).where(inArray(userBookDimensionRatings.reviewId, reviewIds));
    await db.delete(reviewHelpfulVotes).where(inArray(reviewHelpfulVotes.reviewId, reviewIds));
  }
  await db.delete(reviewHelpfulVotes).where(eq(reviewHelpfulVotes.userId, userId));
  await db.delete(userBookReviews).where(eq(userBookReviews.userId, userId));
  await db.delete(readingNotes).where(eq(readingNotes.userId, userId));
  await db.delete(readingSessions).where(eq(readingSessions.userId, userId));
  await db.delete(userBookRatings).where(eq(userBookRatings.userId, userId));
  await db.delete(userOwnedEditions).where(eq(userOwnedEditions.userId, userId));
  await db.delete(upNext).where(eq(upNext.userId, userId));
  await db.delete(userFavoriteBooks).where(eq(userFavoriteBooks.userId, userId));
  await db.delete(readingGoals).where(eq(readingGoals.userId, userId));
  await db.delete(reportCorrections).where(eq(reportCorrections.userId, userId));
  await db.delete(userBookState).where(eq(userBookState.userId, userId));
}

/** POST /api/v1/settings/danger — { action, confirm } */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body || typeof body.action !== "string" || typeof body.confirm !== "string") {
    return jsonError("action and confirm are required.", 400);
  }
  const phrase = PHRASES[body.action];
  if (!phrase) return jsonError("Unknown action.", 400);
  if (body.confirm.toLowerCase().trim() !== phrase) {
    return jsonError(`Type "${phrase}" to confirm.`, 400);
  }

  switch (body.action) {
    case "reset-library":
      await deleteAllUserData(user.userId);
      return jsonOk({});
    case "delete-account": {
      await deleteAllUserData(user.userId);
      // Every REMAINING table with a users FK (authoritative list from
      // pragma_foreign_key_list, 2026-07-16) — without these the users
      // DELETE throws SQLITE_CONSTRAINT_FOREIGNKEY. The web action had the
      // same latent bug; fixed in lockstep.
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
      await db.run(sql`DELETE FROM reported_issues WHERE user_id = ${uid}`);
      await db.run(sql`DELETE FROM auth_refresh_tokens WHERE user_id = ${uid}`);
      await db.run(sql`DELETE FROM password_reset_tokens WHERE user_id = ${uid}`);
      await db.run(sql`UPDATE users SET referred_by_user_id = NULL WHERE referred_by_user_id = ${uid}`);
      await db.delete(users).where(eq(users.id, uid));
      return jsonOk({ signedOut: true });
    }
    case "delete-tbr":
      await db.delete(upNext).where(eq(upNext.userId, user.userId));
      await db.delete(userBookState).where(and(
        eq(userBookState.userId, user.userId),
        eq(userBookState.state, "tbr"),
      ));
      return jsonOk({});
    case "delete-owned":
      await db.delete(userOwnedEditions).where(eq(userOwnedEditions.userId, user.userId));
      await db.update(userBookState)
        .set({ ownedFormats: null, updatedAt: new Date().toISOString() })
        .where(eq(userBookState.userId, user.userId));
      return jsonOk({});
  }
  return jsonError("Unknown action.", 400);
}
