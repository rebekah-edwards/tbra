import { db } from "@/db";
import { readingSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getActiveSession, getNextReadNumber } from "@/lib/queries/reading-session";

/**
 * User-scoped reading-session helpers, moved VERBATIM out of the "use server"
 * actions file (src/lib/actions/reading-session.ts). They always took a userId
 * parameter; living in a plain module means (a) the bearer-authed /api/v1
 * routes can share them without a circular import, and (b) they are no longer
 * accidentally exposed as client-invokable server actions that trusted an
 * arbitrary caller-supplied userId.
 */

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
  // User clicked "Reading Now" so the start date is explicitly today
  const readNumber = await getNextReadNumber(userId, bookId);
  await db.insert(readingSessions).values({
    userId,
    bookId,
    readNumber,
    state: "currently_reading",
    startedAt: new Date().toISOString(),
    startedAtExplicit: true,
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
