"use server";

import { db } from "@/db";
import { upNext } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const MAX_UP_NEXT = 6;

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

  // Read current positions. Positions can be non-contiguous (e.g. user
  // has rows at [1, 3, 5, 6] after a sequence of adds/removes where
  // shift-down didn't run). Pick the LOWEST available slot in 1..MAX
  // to safely fill gaps and avoid UNIQUE collisions.
  const currentRows = await db
    .select({ position: upNext.position })
    .from(upNext)
    .where(eq(upNext.userId, user.userId));
  if (currentRows.length >= MAX_UP_NEXT) {
    return { success: false, error: `Up Next is full (max ${MAX_UP_NEXT})` };
  }

  const occupied = new Set(currentRows.map((r) => r.position));
  let newPosition = -1;
  for (let p = 1; p <= MAX_UP_NEXT; p++) {
    if (!occupied.has(p)) { newPosition = p; break; }
  }
  if (newPosition === -1) {
    // Defensive — shouldn't happen given the count check above
    return { success: false, error: `Up Next is full (max ${MAX_UP_NEXT})` };
  }

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

  // Delete the entry
  await db
    .delete(upNext)
    .where(and(eq(upNext.userId, user.userId), eq(upNext.bookId, bookId)));

  // Compact remaining positions to 1..N. Previously this was a single
  // bulk UPDATE with `position = position - 1` which could hit UNIQUE
  // constraint violations mid-statement on libSQL, leaving users with
  // non-contiguous rows like [1, 3, 5, 6]. Use the same two-phase
  // negative-positions trick as reorderUpNext().
  const remaining = await db
    .select({ id: upNext.id, position: upNext.position })
    .from(upNext)
    .where(eq(upNext.userId, user.userId))
    .orderBy(asc(upNext.position));
  for (let i = 0; i < remaining.length; i++) {
    await db.update(upNext).set({ position: -(i + 1) }).where(eq(upNext.id, remaining[i].id));
  }
  for (let i = 0; i < remaining.length; i++) {
    await db.update(upNext).set({ position: i + 1 }).where(eq(upNext.id, remaining[i].id));
  }

  revalidatePath("/library");
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

  revalidatePath("/library");
}
