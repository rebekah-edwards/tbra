"use server";

import { db } from "@/db";
import { books } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function saveManualCover(
  bookId: string,
  coverUrl: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return { success: false, error: "Admin only" };
  }

  const trimmed = coverUrl.trim();
  if (!trimmed) {
    return { success: false, error: "URL is required" };
  }

  // Basic URL sanity check — must be http(s) and look like an image host
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { success: false, error: "URL must use http or https" };
    }
  } catch {
    return { success: false, error: "Invalid URL" };
  }

  await db
    .update(books)
    .set({
      coverImageUrl: trimmed,
      coverVerified: true,
      coverSource: "manual",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(books.id, bookId));

  revalidatePath("/admin/covers");
  // Also revalidate the book page so the new cover shows immediately
  const row = await db
    .select({ slug: books.slug })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  if (row?.slug) revalidatePath(`/book/${row.slug}`);

  return { success: true };
}

/**
 * Archive a book — sets visibility='hidden' (reversible, preserves data).
 * Use this for books that are effectively junk but have some user activity
 * or would be noisy to hard-delete. For true junk with zero users, use the
 * /admin/issues triage flow which does full FK cleanup.
 */
export async function archiveBook(
  bookId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return { success: false, error: "Admin only" };
  }

  await db
    .update(books)
    .set({
      visibility: "hidden",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(books.id, bookId));

  revalidatePath("/admin/covers");
  return { success: true };
}
