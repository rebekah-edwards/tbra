"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, userPreviousUsernames } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { updateProfileFor } from "@/lib/mutations/profile";
import { del } from "@vercel/blob";
import { unlink } from "fs/promises";
import path from "path";

export async function updateProfile(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Validation + username bookkeeping live in the shared core (also used by
  // PATCH /api/v1/profile for the native Edit Profile, 2026-07-23).
  const result = await updateProfileFor(user.userId, {
    displayName: (formData.get("displayName") as string) ?? null,
    username: (formData.get("username") as string) ?? null,
    bio: (formData.get("bio") as string) ?? null,
    instagram: (formData.get("instagram") as string) ?? null,
    tiktok: (formData.get("tiktok") as string) ?? null,
    threads: (formData.get("threads") as string) ?? null,
    twitter: (formData.get("twitter") as string) ?? null,
    isPrivate: formData.get("isPrivate") === "true",
  });
  if (!result.success) return { error: result.error };

  const updated = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();

  revalidatePath("/profile");
  revalidatePath("/");
  if (updated?.username) {
    revalidatePath(`/u/${updated.username}`);
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
