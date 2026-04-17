"use server";

import { db } from "@/db";
import { upNext } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const MAX_UP_NEXT = 6;

/**
 * Normalize a user's up_next rows so positions are strictly 1..N with
 * no gaps, preserving current visual order. Uses the two-phase
 * "negative positions first" trick to avoid tripping the
 * UNIQUE(user_id, position) constraint mid-update.
 *
 * Called at the start of every mutation (add / remove / reorder) so
 * positions are never left non-contiguous — fixes the class of bug
 * where bulk shifts left users with rows like [1, 3, 5, 6].
 */
async function compactUpNext(userId: string): Promise<{ id: string; position: number }[]> {
  const rows = await db
    .select({ id: upNext.id, position: upNext.position })
    .from(upNext)
    .where(eq(upNext.userId, userId))
    .orderBy(asc(upNext.position));

  const needsCompact = rows.some((r, i) => r.position !== i + 1);
  if (!needsCompact) return rows;

  // Phase 1: move everyone to negative slots (can't collide with positives).
  for (let i = 0; i < rows.length; i++) {
    await db.update(upNext).set({ position: -(i + 1) }).where(eq(upNext.id, rows[i].id));
  }
  // Phase 2: back to contiguous 1..N.
  for (let i = 0; i < rows.length; i++) {
    await db.update(upNext).set({ position: i + 1 }).where(eq(upNext.id, rows[i].id));
  }
  return rows.map((r, i) => ({ id: r.id, position: i + 1 }));
}

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

  // Ensure existing rows are contiguous 1..N before appending.
  const current = await compactUpNext(user.userId);
  if (current.length >= MAX_UP_NEXT) {
    return { success: false, error: `Up Next is full (max ${MAX_UP_NEXT})` };
  }

  const newPosition = current.length + 1;
  await db.insert(upNext).values({
    userId: user.userId,
    bookId,
    position: newPosition,
  });

  revalidatePath("/library");
  revalidatePath(`/book/${bookId}`);
  return { success: true, position: newPosition };
}

export async function removeFromUpNext(bookId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await db
    .delete(upNext)
    .where(and(eq(upNext.userId, user.userId), eq(upNext.bookId, bookId)));

  // Always re-compact so positions stay 1..N contiguous.
  await compactUpNext(user.userId);

  revalidatePath("/library");
  revalidatePath(`/book/${bookId}`);
}

export async function reorderUpNext(bookId: string, newPosition: number): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  if (newPosition < 1 || newPosition > MAX_UP_NEXT) return;

  // Compact first so newPosition maps cleanly to the visible order.
  await compactUpNext(user.userId);

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

  revalidatePath("/library");
}
