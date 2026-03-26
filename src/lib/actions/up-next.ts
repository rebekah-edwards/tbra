"use server";

import { db } from "@/db";
import { upNext } from "@/db/schema";
import { eq, and, gt, asc, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const MAX_UP_NEXT = 5;

export async function addToUpNext(bookId: string): Promise<{ success: boolean; position?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  // Check if already in up next
  const existing = await db
    .select()
    .from(upNext)
    .where(and(eq(upNext.userId, user.userId), eq(upNext.bookId, bookId)))
    .limit(1);
  if (existing.length > 0) return { success: true, position: existing[0].position };

  // Get current count
  const rows = await db
    .select({ id: upNext.id })
    .from(upNext)
    .where(eq(upNext.userId, user.userId));
  if (rows.length >= MAX_UP_NEXT) return { success: false, error: "Up Next is full (max 5)" };

  const newPosition = rows.length + 1;
  await db.insert(upNext).values({
    userId: user.userId,
    bookId,
    position: newPosition,
  });

  revalidatePath("/");
  revalidatePath(`/book/${bookId}`);
  return { success: true, position: newPosition };
}

export async function removeFromUpNext(bookId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  // Get the position being removed
  const row = await db
    .select({ position: upNext.position })
    .from(upNext)
    .where(and(eq(upNext.userId, user.userId), eq(upNext.bookId, bookId)))
    .limit(1);
  if (row.length === 0) return;

  const removedPosition = row[0].position;

  // Delete the entry
  await db
    .delete(upNext)
    .where(and(eq(upNext.userId, user.userId), eq(upNext.bookId, bookId)));

  // Shift positions down for items after the removed one
  await db
    .update(upNext)
    .set({ position: sql`${upNext.position} - 1` })
    .where(and(eq(upNext.userId, user.userId), gt(upNext.position, removedPosition)));

  revalidatePath("/");
  revalidatePath(`/book/${bookId}`);
}

export async function reorderUpNext(bookId: string, newPosition: number): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  if (newPosition < 1 || newPosition > MAX_UP_NEXT) return;

  // Read all items in current order
  const allItems = await db
    .select({ id: upNext.id, bookId: upNext.bookId, position: upNext.position })
    .from(upNext)
    .where(eq(upNext.userId, user.userId))
    .orderBy(asc(upNext.position));

  const currentIndex = allItems.findIndex((item) => item.bookId === bookId);
  if (currentIndex === -1) return;
  if (allItems[currentIndex].position === newPosition) return;

  // Compute new order: remove the item, insert at new position
  const reordered = [...allItems];
  const [moved] = reordered.splice(currentIndex, 1);
  reordered.splice(newPosition - 1, 0, moved);

  // Phase 1: move all to negative positions to avoid UNIQUE conflicts.
  // Phase 2: set final positions.
  for (let i = 0; i < reordered.length; i++) {
    await db.update(upNext).set({ position: -(i + 1) }).where(eq(upNext.id, reordered[i].id));
  }
  for (let i = 0; i < reordered.length; i++) {
    await db.update(upNext).set({ position: i + 1 }).where(eq(upNext.id, reordered[i].id));
  }

  revalidatePath("/");
}
