"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, userPreviousUsernames } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { del } from "@vercel/blob";
import { unlink } from "fs/promises";
import path from "path";

export async function updateProfile(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const displayName = (formData.get("displayName") as string)?.trim() || null;
  const rawUsername = (formData.get("username") as string)?.trim() || null;
  const bio = (formData.get("bio") as string)?.trim() || null;

  // Social handles — strip @ prefix, allow only valid handle chars
  const sanitizeHandle = (v: string | null) =>
    v?.replace(/^@/, "").replace(/[^a-zA-Z0-9_.]/g, "").trim() || null;
  const instagram = sanitizeHandle(formData.get("instagram") as string);
  const tiktok = sanitizeHandle(formData.get("tiktok") as string);
  const threads = sanitizeHandle(formData.get("threads") as string);
  const twitter = sanitizeHandle(formData.get("twitter") as string);

  // Privacy toggle
  const isPrivate = formData.get("isPrivate") === "true";

  // Fetch current user state once for all checks below
  const currentUser = await db
    .select({ username: users.username, usernameChangedAt: users.usernameChangedAt })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();

  // Validate username
  let username: string | null = null;
  if (rawUsername) {
    username = rawUsername.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (username.length < 3) {
      return { error: "Username must be at least 3 characters." };
    }
    if (username.length > 30) {
      return { error: "Username must be 30 characters or fewer." };
    }
    // Check uniqueness
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .get();
    if (existing && existing.id !== user.userId) {
      return { error: "That username is already taken." };
    }

    // Rate limit: 1 change per 30 days (skip if username is unchanged)
    if (currentUser?.username && currentUser.username !== username && currentUser.usernameChangedAt) {
      const lastChange = new Date(currentUser.usernameChangedAt);
      const daysSince = (Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) {
        const daysLeft = Math.ceil(30 - daysSince);
        return { error: `You can change your username again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` };
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
      if (generated.length > 30) {
        generated = generated.slice(0, 30);
      }
      // Check uniqueness, append random digits if taken
      const existingGenerated = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, generated))
        .get();
      if (existingGenerated && existingGenerated.id !== user.userId) {
        const suffix = Math.floor(100 + Math.random() * 900).toString();
        generated = generated.slice(0, 27) + suffix;
      }
      username = generated;
    }
  }

  const usernameChanged = username && currentUser?.username !== username;

  // Record the old handle so /u/{oldhandle} links keep working.
  // Also: if another user had 'username' reserved as a previous handle of
  // theirs, clear that row so we don't silently shadow this new owner.
  if (usernameChanged) {
    if (currentUser?.username) {
      await db
        .insert(userPreviousUsernames)
        .values({ username: currentUser.username, userId: user.userId })
        .onConflictDoUpdate({
          target: userPreviousUsernames.username,
          set: { userId: user.userId, changedAt: sql`(datetime('now'))` },
        });
    }
    // If the user is reclaiming a handle that was someone else's previous
    // handle, drop that old mapping — the new active owner wins.
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
    .where(eq(users.id, user.userId));

  revalidatePath("/profile");
  revalidatePath("/");
  if (username) {
    revalidatePath(`/u/${username}`);
  }
  redirect("/profile");
}

export async function deleteAvatar() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const existing = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();

  if (existing?.avatarUrl) {
    const isProduction = !!process.env.TURSO_DATABASE_URL;
    if (isProduction && (existing.avatarUrl.includes("vercel-storage.com") || existing.avatarUrl.includes("blob.vercel-storage.com"))) {
      try {
        await del(existing.avatarUrl);
      } catch {
        // Old blob may not exist
      }
    } else if (!isProduction && existing.avatarUrl.startsWith("/uploads/")) {
      const oldPath = path.join(process.cwd(), "public", existing.avatarUrl);
      try {
        await unlink(oldPath);
      } catch {
        // Old file may not exist
      }
    }
  }

  await db
    .update(users)
    .set({ avatarUrl: null })
    .where(eq(users.id, user.userId));

  revalidatePath("/", "layout");
  revalidatePath("/profile");
  revalidatePath("/");
}
