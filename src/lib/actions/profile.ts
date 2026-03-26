"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
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
  }

  await db
    .update(users)
    .set({ displayName, username, bio, instagram, tiktok, threads, twitter, isPrivate })
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
