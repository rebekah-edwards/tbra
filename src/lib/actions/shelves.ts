"use server";

import { db } from "@/db";
import { shelves, shelfBooks, userNotifications, users } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  createShelfFor,
  updateShelfFor,
  deleteShelfFor,
  reorderShelvesFor,
  addBookToShelfFor,
  followShelfFor,
  unfollowShelfFor,
  removeBookFromShelfFor,
  reorderShelfBooksFor,
} from "@/lib/mutations/shelves";

/**
 * Web server actions for shelves. The core write logic lives in
 * @/lib/mutations/shelves (shared with the native API); these wrappers resolve
 * the session user and handle web-only cache revalidation. Return shapes are
 * unchanged from before the extraction.
 *
 * The functions still defined inline below (bulk remove, toggle, note,
 * follow/unfollow) are not yet used by the native API and keep their original
 * implementation until a later slice needs them.
 */

// ─── Create shelf ───

export async function createShelf(
  name: string,
  description?: string,
  isPublic?: boolean,
  color?: string,
): Promise<{ success: boolean; shelfId?: string; slug?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const result = await createShelfFor(user.userId, user.accountType, name, description, isPublic, color);

  if (result.success) {
    revalidatePath("/library/shelves");
    revalidatePath("/profile");
  }
  return result;
}

// ─── Update shelf ───

export async function updateShelf(
  shelfId: string,
  data: { name?: string; description?: string; isPublic?: boolean; color?: string | null; coverImageUrl?: string | null },
): Promise<{ success: boolean; slug?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const result = await updateShelfFor(user.userId, shelfId, data);

  if (result.success) {
    revalidatePath("/library/shelves");
    revalidatePath(`/library/shelves/${result.slug}`);
    revalidatePath("/profile");
  }
  return result;
}

// ─── Delete shelf ───

export async function deleteShelf(shelfId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const result = await deleteShelfFor(user.userId, shelfId);

  if (result.success) {
    revalidatePath("/library/shelves");
    revalidatePath("/profile");
  }
  return result;
}

// ─── Reorder shelves ───

export async function reorderShelves(shelfIds: string[]): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  const result = await reorderShelvesFor(user.userId, shelfIds);

  if (result.success) revalidatePath("/library/shelves");
  return result;
}

// ─── Add book to shelf ───

export async function addBookToShelf(
  shelfId: string,
  bookId: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const result = await addBookToShelfFor(user.userId, shelfId, bookId, note);

  if (result.added) {
    revalidatePath("/library/shelves");
    revalidatePath(`/library/shelves/${result.slug}`);
    revalidatePath(`/book/${bookId}`);
  }
  return { success: result.success, error: result.error };
}

// ─── Remove book from shelf ───

export async function removeBookFromShelf(
  shelfId: string,
  bookId: string,
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  const result = await removeBookFromShelfFor(user.userId, shelfId, bookId);

  if (result.removed) {
    revalidatePath("/library/shelves");
    revalidatePath(`/library/shelves/${result.slug}`);
    revalidatePath(`/book/${bookId}`);
  }
  return { success: result.success };
}

// ─── Reorder books within shelf ───

export async function reorderShelfBooks(
  shelfId: string,
  bookIds: string[],
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  const result = await reorderShelfBooksFor(user.userId, shelfId, bookIds);

  if (result.success) revalidatePath(`/library/shelves/${result.slug}`);
  return { success: result.success };
}

// ─── Bulk remove books from shelf ───

export async function bulkRemoveFromShelf(
  shelfId: string,
  bookIds: string[],
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };
  if (bookIds.length === 0) return { success: true };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) return { success: false };

  const inClause = bookIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  await db.run(sql.raw(`DELETE FROM shelf_books WHERE shelf_id = '${shelfId.replace(/'/g, "''")}' AND book_id IN (${inClause})`));

  // Reorder remaining books sequentially
  const remaining = await db
    .select({ bookId: shelfBooks.bookId })
    .from(shelfBooks)
    .where(eq(shelfBooks.shelfId, shelfId))
    .orderBy(asc(shelfBooks.position))
    .all();

  for (let i = 0; i < remaining.length; i++) {
    await db.update(shelfBooks)
      .set({ position: i + 1 })
      .where(and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, remaining[i].bookId)));
  }

  revalidatePath("/library/shelves");
  revalidatePath(`/library/shelves/${shelf.slug}`);
  return { success: true };
}

// ─── Toggle book on shelf ───

export async function toggleBookOnShelf(
  shelfId: string,
  bookId: string,
): Promise<{ success: boolean; isOnShelf: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, isOnShelf: false, error: "Not logged in" };

  const existing = await db
    .select()
    .from(shelfBooks)
    .where(and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, bookId)))
    .get();

  if (existing) {
    await removeBookFromShelf(shelfId, bookId);
    return { success: true, isOnShelf: false };
  } else {
    const result = await addBookToShelf(shelfId, bookId);
    return { success: result.success, isOnShelf: result.success, error: result.error };
  }
}

// ─── Update book note ───

export async function updateShelfBookNote(
  shelfId: string,
  bookId: string,
  note: string | null,
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) return { success: false };

  await db.run(sql`
    UPDATE shelf_books SET note = ${note?.trim() || null}
    WHERE shelf_id = ${shelfId} AND book_id = ${bookId}
  `);

  revalidatePath(`/library/shelves/${shelf.slug}`);
  return { success: true };
}

// ─── Follow / unfollow shelf ───

export async function followShelf(shelfId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const result = await followShelfFor(user.userId, shelfId);
  if (result.success) revalidatePath("/library/shelves");
  return result;
}

export async function unfollowShelf(shelfId: string): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  const result = await unfollowShelfFor(user.userId, shelfId);
  revalidatePath("/library/shelves");
  return result;
}

export async function toggleFollowShelf(shelfId: string): Promise<{ success: boolean; isFollowing: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, isFollowing: false, error: "Not logged in" };

  const existing = await db.all(sql`
    SELECT user_id FROM shelf_follows WHERE user_id = ${user.userId} AND shelf_id = ${shelfId}
  `);

  if (existing.length > 0) {
    await unfollowShelf(shelfId);
    return { success: true, isFollowing: false };
  } else {
    const result = await followShelf(shelfId);
    return { success: result.success, isFollowing: result.success, error: result.error };
  }
}
