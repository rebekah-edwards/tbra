/**
 * Up Next write logic — plain, userId-taking functions shared by the web
 * server actions (src/lib/actions/up-next.ts) and the native API
 * (src/app/api/v1/up-next). No auth (caller passes a verified userId) and no
 * revalidatePath (that's web-only; the action wrapper handles it).
 *
 * The two-phase "negative positions first" renumbering below is the guard
 * against the UNIQUE(user_id, position) collisions and the "a position ends up
 * empty / order breaks" bug — preserved verbatim from the original actions.
 */
import { db } from "@/db";
import { upNext } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

export const MAX_UP_NEXT = 6;

/**
 * Normalize a user's up_next rows so positions are strictly 1..N with no gaps,
 * preserving current visual order. Uses the two-phase "negative positions
 * first" trick to avoid tripping the UNIQUE(user_id, position) constraint
 * mid-update. Called at the start of every mutation.
 */
export async function compactUpNext(userId: string): Promise<{ id: string; position: number }[]> {
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

export async function addToUpNextFor(
  userId: string,
  bookId: string,
): Promise<{ success: boolean; position?: number; error?: string; added?: boolean }> {
  // Check if already in up next
  const existing = await db
    .select()
    .from(upNext)
    .where(and(eq(upNext.userId, userId), eq(upNext.bookId, bookId)))
    .limit(1);
  if (existing.length > 0) return { success: true, position: existing[0].position, added: false };

  // Ensure existing rows are contiguous 1..N before appending.
  const current = await compactUpNext(userId);
  if (current.length >= MAX_UP_NEXT) {
    return { success: false, error: `Up Next is full (max ${MAX_UP_NEXT})` };
  }

  const newPosition = current.length + 1;
  await db.insert(upNext).values({ userId, bookId, position: newPosition });

  return { success: true, position: newPosition, added: true };
}

export async function removeFromUpNextFor(userId: string, bookId: string): Promise<void> {
  await db
    .delete(upNext)
    .where(and(eq(upNext.userId, userId), eq(upNext.bookId, bookId)));

  // Always re-compact so positions stay 1..N contiguous.
  await compactUpNext(userId);
}

/**
 * Single-item reorder (web drag): move one book to newPosition, shifting the
 * rest. Preserved from the original action.
 */
export async function reorderUpNextItemFor(
  userId: string,
  bookId: string,
  newPosition: number,
): Promise<void> {
  if (newPosition < 1 || newPosition > MAX_UP_NEXT) return;

  // Compact first so newPosition maps cleanly to the visible order.
  await compactUpNext(userId);

  const allItems = await db
    .select({ id: upNext.id, bookId: upNext.bookId, position: upNext.position })
    .from(upNext)
    .where(eq(upNext.userId, userId))
    .orderBy(asc(upNext.position));

  const currentIndex = allItems.findIndex((item) => item.bookId === bookId);
  if (currentIndex === -1) return;
  if (allItems[currentIndex].position === newPosition) return;

  const reordered = [...allItems];
  const [moved] = reordered.splice(currentIndex, 1);
  reordered.splice(newPosition - 1, 0, moved);

  // Phase 1: negative positions to avoid UNIQUE conflicts. Phase 2: final.
  for (let i = 0; i < reordered.length; i++) {
    await db.update(upNext).set({ position: -(i + 1) }).where(eq(upNext.id, reordered[i].id));
  }
  for (let i = 0; i < reordered.length; i++) {
    await db.update(upNext).set({ position: i + 1 }).where(eq(upNext.id, reordered[i].id));
  }
}

/**
 * Whole-order reorder (native drag): the client sends the complete, final
 * ordering of book IDs and we renumber to match. Same two-phase guard as the
 * shelf reorder. The caller must pass the *complete* current set in the
 * desired order (the API route validates this).
 */
export async function reorderUpNextOrderFor(userId: string, bookIds: string[]): Promise<void> {
  // Phase 1: move all to negative positions to avoid UNIQUE conflicts.
  for (let i = 0; i < bookIds.length; i++) {
    await db
      .update(upNext)
      .set({ position: -(i + 1) })
      .where(and(eq(upNext.userId, userId), eq(upNext.bookId, bookIds[i])));
  }
  // Phase 2: set final contiguous positions.
  for (let i = 0; i < bookIds.length; i++) {
    await db
      .update(upNext)
      .set({ position: i + 1 })
      .where(and(eq(upNext.userId, userId), eq(upNext.bookId, bookIds[i])));
  }
}
