import { db } from "@/db";
import { users, userPreviousUsernames } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export interface UpdateProfileInput {
  displayName: string | null;
  username: string | null; // raw — sanitized here
  bio: string | null;
  instagram: string | null;
  tiktok: string | null;
  threads: string | null;
  twitter: string | null;
  isPrivate: boolean;
}

const sanitizeHandle = (v: string | null) =>
  v?.replace(/^@/, "").replace(/[^a-zA-Z0-9_.]/g, "").trim() || null;

/**
 * User-scoped core of the updateProfile server action — identical
 * validation, username rate-limit, and previous-username bookkeeping,
 * shared by the web action and PATCH /api/v1/profile (native Edit Profile,
 * 2026-07-23).
 */
export async function updateProfileFor(
  userId: string,
  input: UpdateProfileInput
): Promise<{ success: boolean; error?: string }> {
  const displayName = input.displayName?.trim() || null;
  const rawUsername = input.username?.trim() || null;
  const bio = input.bio?.trim() || null;
  const instagram = sanitizeHandle(input.instagram);
  const tiktok = sanitizeHandle(input.tiktok);
  const threads = sanitizeHandle(input.threads);
  const twitter = sanitizeHandle(input.twitter);
  const isPrivate = input.isPrivate;

  const currentUser = await db
    .select({ username: users.username, usernameChangedAt: users.usernameChangedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  let username: string | null = null;
  if (rawUsername) {
    username = rawUsername.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (username.length < 3) return { success: false, error: "Username must be at least 3 characters." };
    if (username.length > 30) return { success: false, error: "Username must be 30 characters or fewer." };
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .get();
    if (existing && existing.id !== userId) {
      return { success: false, error: "That username is already taken." };
    }
    if (currentUser?.username && currentUser.username !== username && currentUser.usernameChangedAt) {
      const lastChange = new Date(currentUser.usernameChangedAt);
      const daysSince = (Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) {
        const daysLeft = Math.ceil(30 - daysSince);
        return { success: false, error: `You can change your username again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` };
      }
    }
  }

  // Auto-generate username from display name if user has no username
  if (!username && displayName && !currentUser?.username) {
    let generated = displayName
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (generated.length >= 3) {
      if (generated.length > 30) generated = generated.slice(0, 30);
      const existingGenerated = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, generated))
        .get();
      if (existingGenerated && existingGenerated.id !== userId) {
        const suffix = Math.floor(100 + Math.random() * 900).toString();
        generated = generated.slice(0, 27) + suffix;
      }
      username = generated;
    }
  }

  const usernameChanged = !!username && currentUser?.username !== username;

  // Record the old handle so /u/{oldhandle} links keep working; clear any
  // other user's stale claim on the new handle.
  if (usernameChanged && username) {
    if (currentUser?.username) {
      await db
        .insert(userPreviousUsernames)
        .values({ username: currentUser.username, userId })
        .onConflictDoUpdate({
          target: userPreviousUsernames.username,
          set: { userId, changedAt: sql`(datetime('now'))` },
        });
    }
    await db
      .delete(userPreviousUsernames)
      .where(eq(userPreviousUsernames.username, username));
  }

  await db
    .update(users)
    .set({
      displayName, username, bio, instagram, tiktok, threads, twitter, isPrivate,
      ...(usernameChanged ? { usernameChangedAt: new Date().toISOString() } : {}),
    })
    .where(eq(users.id, userId));

  return { success: true };
}
