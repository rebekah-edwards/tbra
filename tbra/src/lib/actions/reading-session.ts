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
    // Complete the active session
    await db
      .update(readingSessions)
      .set({
        state,
        completionDate,
        completionPrecision,
        activeFormats: null,
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
  revalidatePath("/");
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
      .set({ state: "paused", updatedAt: new Date().toISOString() })
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
    await db
      .update(readingSessions)
      .set({ state: "currently_reading", updatedAt: new Date().toISOString() })
      .where(eq(readingSessions.id, active.id));
  }
}
