"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userBookState, readingSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getLatestSession, getActiveSession, getNextReadNumber } from "@/lib/queries/reading-session";
import { setBookStateWithCompletionFor } from "@/lib/mutations/reading-state";

/**
 * Combined action for marking a book as completed or DNF.
 * Updates user_book_state AND creates/updates the reading session with completion date.
 */
export async function setBookStateWithCompletion(
  bookId: string,
  state: "completed" | "dnf",
  completionDate: string | null,
  completionPrecision: "exact" | "month" | "year" | null
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Shared user-scoped implementation (also used by /api/v1) — see
  // src/lib/mutations/reading-state.ts. Behavior is the exact former body
  // of this action.
  await setBookStateWithCompletionFor(userId, bookId, state, completionDate, completionPrecision);

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/profile");
}

// ensureReadingSession / pauseActiveSession / resumeActiveSession moved to
// src/lib/mutations/reading-session.ts (plain module, shared with /api/v1 —
// and no longer exposed as server actions trusting a caller-supplied userId).

/**
 * Update fields on an existing reading session.
 * Only the session owner can update.
 *
 * `activeFormats` accepts an array (will be JSON-serialized) or null to clear.
 * Used by the per-session format editor in Reading History so users can
 * retro-tag past completed sessions as audio/print/etc — drives the Stats
 * page's Pages-read / Listened split for sessions that predated session-level
 * format propagation (Round 17).
 */
export async function updateReadingSession(
  sessionId: string,
  data: {
    startedAt?: string;
    completionDate?: string | null;
    pausedAt?: string | null;
    activeFormats?: string[] | null;
  }
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return updateReadingSessionFor(userId, sessionId, data);
}

/** Core update, callable with an explicit user id (used by /api/v1). */
export async function updateReadingSessionFor(
  userId: string,
  sessionId: string,
  data: {
    startedAt?: string;
    completionDate?: string | null;
    pausedAt?: string | null;
    activeFormats?: string[] | null;
  }
) {
  // Verify ownership
  const session = await db
    .select()
    .from(readingSessions)
    .where(eq(readingSessions.id, sessionId))
    .get();

  if (!session || session.userId !== userId) {
    throw new Error("Session not found");
  }

  const updates: Record<string, string | number | null> = {
    updatedAt: new Date().toISOString(),
  };

  if (data.startedAt !== undefined) {
    // User explicitly edited the start date — mark as explicit
    updates.startedAt = data.startedAt;
    updates.startedAtExplicit = 1;
  }
  if (data.completionDate !== undefined) {
    updates.completionDate = data.completionDate;
    updates.completionPrecision = data.completionDate ? "exact" : null;
  }
  if (data.pausedAt !== undefined) {
    updates.pausedAt = data.pausedAt;
  }
  if (data.activeFormats !== undefined) {
    updates.activeFormats =
      data.activeFormats && data.activeFormats.length > 0
        ? JSON.stringify(data.activeFormats)
        : null;
  }

  await db
    .update(readingSessions)
    .set(updates)
    .where(eq(readingSessions.id, sessionId));

  revalidatePath(`/book/${session.bookId}`);
  revalidatePath("/profile");
  revalidatePath("/stats");
}

/**
 * Add a new re-read session for a book.
 * Creates a completed session with the next read_number.
 */
export async function addRereadSession(
  bookId: string,
  data: { startedAt?: string; completionDate?: string | null }
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return addRereadSessionFor(userId, bookId, data);
}

/** Core re-read insert, callable with an explicit user id (used by /api/v1). */
export async function addRereadSessionFor(
  userId: string,
  bookId: string,
  data: { startedAt?: string; completionDate?: string | null }
) {
  const readNumber = await getNextReadNumber(userId, bookId);
  const now = new Date().toISOString();

  await db.insert(readingSessions).values({
    userId: userId,
    bookId,
    readNumber,
    state: "completed",
    startedAt: data.startedAt || now,
    startedAtExplicit: !!data.startedAt,
    completionDate: data.completionDate || null,
    completionPrecision: data.completionDate ? "exact" : null,
  });

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/profile");
}

/**
 * Delete a reading session.
 * Only the session owner can delete.
 */
export async function deleteReadingSession(sessionId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return deleteReadingSessionFor(userId, sessionId);
}

/** Core delete, callable with an explicit user id (used by /api/v1). */
export async function deleteReadingSessionFor(userId: string, sessionId: string) {
  // Verify ownership
  const session = await db
    .select()
    .from(readingSessions)
    .where(eq(readingSessions.id, sessionId))
    .get();

  if (!session || session.userId !== userId) {
    throw new Error("Session not found");
  }

  await db
    .delete(readingSessions)
    .where(eq(readingSessions.id, sessionId));

  revalidatePath(`/book/${session.bookId}`);
  revalidatePath("/profile");
}
