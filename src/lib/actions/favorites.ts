"use server";

import { db } from "@/db";
import { userFavoriteBooks } from "@/db/schema";
import { eq, and, gt, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const MAX_FAVORITES = 10;

export async function addFavorite(bookId: string): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  // Check count
  const existing = await db
    .select({ id: userFavoriteBooks.id })
    .from(userFavoriteBooks)
    .where(eq(userFavoriteBooks.userId, session.userId))
    .all();

  if (existing.length >= MAX_FAVORITES) {
    return { success: false, error: `Maximum ${MAX_FAVORITES} favorites` };
  }

  // Check if already favorited
  const alreadyFav = await db
    .select({ id: userFavoriteBooks.id })
    .from(userFavoriteBooks)
    .where(and(eq(userFavoriteBooks.userId, session.userId), eq(userFavoriteBooks.bookId, bookId)))
    .get();

  if (alreadyFav) return { success: true }; // Already favorited

  const nextPosition = existing.length + 1;

  await db.insert(userFavoriteBooks).values({
    userId: session.userId,
    bookId,
    position: nextPosition,
  });

  revalidatePath("/profile");
  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

export async function removeFavorite(bookId: string): Promise<{ success: boolean }> {
  const session = await getCurrentUser();
  if (!session) return { success: false };

  const fav = await db
    .select({ id: userFavoriteBooks.id, position: userFavoriteBooks.position })
    .from(userFavoriteBooks)
    .where(and(eq(userFavoriteBooks.userId, session.userId), eq(userFavoriteBooks.bookId, bookId)))
    .get();

  if (!fav) return { success: true };

  await db.delete(userFavoriteBooks).where(eq(userFavoriteBooks.id, fav.id));

  // Reorder positions for remaining favorites
  await db.run(sql`
    UPDATE user_favorite_books
    SET position = position - 1
    WHERE user_id = ${session.userId} AND position > ${fav.position}
  `);

  revalidatePath("/profile");
  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

export async function toggleFavorite(bookId: string): Promise<{ success: boolean; isFavorited: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, isFavorited: false, error: "Not logged in" };

  const existing = await db
    .select({ id: userFavoriteBooks.id })
    .from(userFavoriteBooks)
    .where(and(eq(userFavoriteBooks.userId, session.userId), eq(userFavoriteBooks.bookId, bookId)))
    .get();

  if (existing) {
    await removeFavorite(bookId);
    return { success: true, isFavorited: false };
  } else {
    const result = await addFavorite(bookId);
    return { success: result.success, isFavorited: result.success, error: result.error };
  }
}
