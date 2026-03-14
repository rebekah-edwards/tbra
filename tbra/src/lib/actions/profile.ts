"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";

export async function updateProfile(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const displayName = (formData.get("displayName") as string)?.trim() || null;

  await db
    .update(users)
    .set({ displayName })
    .where(eq(users.id, user.userId));

  revalidatePath("/profile");
  revalidatePath("/");
  redirect("/profile");
}

export async function uploadAvatar(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const file = formData.get("avatar") as File;
  if (!file || file.size === 0) return;

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const allowedExts = ["jpg", "jpeg", "png", "gif", "webp"];
  if (!allowedExts.includes(ext)) {
    throw new Error("Invalid file type");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("File too large (max 5MB)");
  }

  const filename = `${user.userId}-${Date.now()}.${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");

  await mkdir(uploadDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadDir, filename), buffer);

  // Delete old avatar if it exists
  const existing = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();

  if (existing?.avatarUrl) {
    const oldPath = path.join(process.cwd(), "public", existing.avatarUrl);
    try {
      await unlink(oldPath);
    } catch {
      // Old file may not exist
    }
  }

  const avatarUrl = `/uploads/avatars/${filename}`;
  await db
    .update(users)
    .set({ avatarUrl })
    .where(eq(users.id, user.userId));

  revalidatePath("/profile");
  revalidatePath("/");
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
    const oldPath = path.join(process.cwd(), "public", existing.avatarUrl);
    try {
      await unlink(oldPath);
    } catch {
      // Old file may not exist
    }
  }

  await db
    .update(users)
    .set({ avatarUrl: null })
    .where(eq(users.id, user.userId));

  revalidatePath("/profile");
  revalidatePath("/");
}
