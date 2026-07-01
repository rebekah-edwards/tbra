"use server";

import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  addToUpNextFor,
  removeFromUpNextFor,
  reorderUpNextItemFor,
} from "@/lib/mutations/up-next";

/**
 * Web server actions for Up Next. These are thin wrappers: they resolve the
 * current user from the session cookie, delegate to the shared mutations in
 * @/lib/mutations/up-next (also used by the native API), and handle web-only
 * cache revalidation. Return shapes are unchanged from before the extraction.
 */

export async function addToUpNext(
  bookId: string,
): Promise<{ success: boolean; position?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const result = await addToUpNextFor(user.userId, bookId);

  // Only revalidate when a row was actually inserted (matches prior behavior).
  if (result.added) {
    revalidatePath("/library");
    revalidatePath(`/book/${bookId}`);
  }

  return { success: result.success, position: result.position, error: result.error };
}

export async function removeFromUpNext(bookId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await removeFromUpNextFor(user.userId, bookId);

  revalidatePath("/library");
  revalidatePath(`/book/${bookId}`);
}

export async function reorderUpNext(bookId: string, newPosition: number): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await reorderUpNextItemFor(user.userId, bookId, newPosition);

  revalidatePath("/library");
}
