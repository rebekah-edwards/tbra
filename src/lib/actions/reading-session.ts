"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userBookState, readingSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getLatestSession, getActiveSession, getNextReadNumber } from "@/lib/queries/reading-session";

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

  // 1. Update user_book_state (the cache table)
  const existing = await db
    .select()
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, user.userId),
        eq(userBookState.bookId, bookId)
      )
    )
    .get();

  if (existing) {
    await db
      .update(userBookState)
      .set({ state, activeFormats: null, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(userBookState.userId, user.userId),
          eq(userBookState.bookId, bookId)
        )
      );
  } else {
    await db.insert(userBookState).values({
      userId: user.userId,
      bookId,
      state,
    });
  }

  // 2. Update or create the reading session
  const activeSession = await getActiveSession(user.userId, bookId);

  if (activeSession) {
    // Complete the active session — preserve activeFormats as a record of how it was read
    await db
      .update(readingSessions)
      .set({
        state,
        completionDate,
        completionPrecision,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(readingSessions.id, activeSession.id));
  } else {
    // No active session — create one (e.g., user clicked "Finished" directly without "Reading Now" first)
    const readNumber = await getNextReadNumber(user.userId, bookId);
    await db.insert(readingSessions).values({
      userId: user.userId,
      bookId,
      readNumber,
      state,
      completionDate,
      completionPrecision,
    });
  }

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/profile");
}

/**
 * Create a new reading session when entering "currently_reading".
 * If an active session exists, this is a no-op.
 * If the latest session is completed/dnf, creates a new session (re-read).
 */
export async function ensureReadingSession(
  userId: string,
  bookId: string,
  activeFormats: string | null
): Promise<void> {
  const active = await getActiveSession(userId, bookId);
  if (active) {
    // Already have an active session, just update formats if needed
    if (activeFormats !== null) {
      await db
        .update(readingSessions)
        .set({ activeFormats, updatedAt: new Date().toISOString() })
        .where(eq(readingSessions.id, active.id));
    }
    return;
  }

  // No active session — create a new one
  const readNumber = await getNextReadNumber(userId, bookId);
  await db.insert(readingSessions).values({
    userId,
    bookId,
    readNumber,
    state: "currently_reading",
    activeFormats,
  });
}

/**
 * Pause the active reading session.
 */
export async function pauseActiveSession(
  userId: string,
  bookId: string
): Promise<void> {
  const active = await getActiveSession(userId, bookId);
  if (active) {
    await db
      .update(readingSessions)
      .set({
        state: "paused",
        pausedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(readingSessions.id, active.id));
  }
}

/**
 * Resume a paused session back to currently_reading.
 */
export async function resumeActiveSession(
  userId: string,
  bookId: string
): Promise<void> {
  const active = await getActiveSession(userId, bookId);
  if (active && active.state === "paused") {
    // Calculate days spent paused and add to running total
    let additionalPausedDays = 0;
    if (active.pausedAt) {
      const pausedMs = Date.now() - new Date(active.pausedAt).getTime();
      additionalPausedDays = Math.max(0, Math.round(pausedMs / (1000 * 60 * 60 * 24)));
    }
    const totalPaused = (active.totalPausedDays ?? 0) + additionalPausedDays;

    await db
      .update(readingSessions)
      .set({
        state: "currently_reading",
        pausedAt: null,
        totalPausedDays: totalPaused,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(readingSessions.id, active.id));
  }
}

/**
 * Update dates on an existing reading session.
 * Only the session owner can update.
 */
export async function updateReadingSession(
  sessionId: string,
  data: { startedAt?: string; completionDate?: string | null; pausedAt?: string | null }
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Verify ownership
  const session = await db
    .select()
    .from(readingSessions)
    .where(eq(readingSessions.id, sessionId))
    .get();

  if (!session || session.userId !== user.userId) {
    throw new Error("Session not found");
  }

  const updates: Record<string, string | null> = {
    updatedAt: new Date().toISOString(),
  };

  if (data.startedAt !== undefined) {
    updates.startedAt = data.startedAt;
  }
  if (data.completionDate !== undefined) {
    updates.completionDate = data.completionDate;
    updates.completionPrecision = data.completionDate ? "exact" : null;
  }
  if (data.pausedAt !== undefined) {
    updates.pausedAt = data.pausedAt;
  }

  await db
    .update(readingSessions)
    .set(updates)
    .where(eq(readingSessions.id, sessionId));

  revalidatePath(`/book/${session.bookId}`);
  revalidatePath("/profile");
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

  const readNumber = await getNextReadNumber(user.userId, bookId);
  const now = new Date().toISOString();

  await db.insert(readingSessions).values({
    userId: user.userId,
    bookId,
    readNumber,
    state: "completed",
    startedAt: data.startedAt || now,
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

  // Verify ownership
  const session = await db
    .select()
    .from(readingSessions)
    .where(eq(readingSessions.id, sessionId))
    .get();

  if (!session || session.userId !== user.userId) {
    throw new Error("Session not found");
  }

  await db
    .delete(readingSessions)
    .where(eq(readingSessions.id, sessionId));

  revalidatePath(`/book/${session.bookId}`);
  revalidatePath("/profile");
}
