import { db } from "@/db";
import { userBookState, readingSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { parseFormats } from "@/lib/reading-formats";
import {
  ensureReadingSession,
  pauseActiveSession,
  resumeActiveSession,
} from "@/lib/mutations/reading-session";
import { getActiveSession, getNextReadNumber } from "@/lib/queries/reading-session";
import { removeFromUpNextFor } from "@/lib/mutations/up-next";

/**
 * User-scoped reading-state mutations, extracted VERBATIM from the cookie-authed
 * server actions in src/lib/actions/reading-state.ts / reading-session.ts so the
 * bearer-authed /api/v1 routes can share the exact same state machine. The server
 * actions delegate here — one implementation, two auth front-doors.
 *
 * ⚠️ This state machine is the most-debugged code in the app (sessions,
 * pause-day accounting, format preservation, impossible-timeline guards).
 * Do not "simplify" it — behavior must stay byte-equivalent with the web.
 */

export async function setBookStateFor(userId: string, bookId: string, state: string) {
  const existing = await db
    .select()
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, userId),
        eq(userBookState.bookId, bookId)
      )
    )
    .get();

  // Preserve activeFormats when entering currently_reading, clear when leaving
  // If entering with exactly one owned format, pre-select it
  let activeFormats: string | null = null;
  if (state === "currently_reading") {
    if (existing?.activeFormats) {
      activeFormats = existing.activeFormats;
    } else {
      const formats = parseFormats(existing?.ownedFormats);
      if (formats.length === 1) {
        activeFormats = JSON.stringify(formats);
      }
    }
  }

  if (existing) {
    await db
      .update(userBookState)
      .set({ state, activeFormats, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(userBookState.userId, userId),
          eq(userBookState.bookId, bookId)
        )
      );
  } else {
    await db.insert(userBookState).values({
      userId,
      bookId,
      state,
      activeFormats,
    });
  }

  // Remove from Up Next when starting to read
  if (state === "currently_reading") {
    await removeFromUpNextFor(userId, bookId);
  }

  // Sync reading session
  if (state === "currently_reading") {
    await ensureReadingSession(userId, bookId, activeFormats);
    // If the active session was paused (user clicked "Reading Now" to resume),
    // properly resume it so the paused-time gets accumulated into total_paused_days
    // and the stats only count Reading-Now days.
    await resumeActiveSession(userId, bookId);
  } else if (state === "paused") {
    // Ensure a reading session exists before pausing — if a book goes straight
    // to "paused" (e.g., imported without a session), create one first so
    // the reader has a start date, then pause it.
    await ensureReadingSession(userId, bookId, activeFormats);
    await pauseActiveSession(userId, bookId);
  }
  // Note: "completed" and "dnf" are handled by setBookStateWithCompletionFor
  // (called with date info). "tbr" doesn't need a session.
}

export async function setBookStateWithCompletionFor(
  userId: string,
  bookId: string,
  state: "completed" | "dnf",
  completionDate: string | null,
  completionPrecision: "exact" | "month" | "year" | null
) {
  // 1. Update user_book_state (the cache table)
  const existing = await db
    .select()
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, userId),
        eq(userBookState.bookId, bookId)
      )
    )
    .get();

  // Capture the user's current format selection BEFORE we null it on the cache,
  // so we can preserve it on the reading session below (so stats know how the
  // book was read).
  const cachedFormats = existing?.activeFormats ?? null;

  if (existing) {
    await db
      .update(userBookState)
      .set({ state, activeFormats: null, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(userBookState.userId, userId),
          eq(userBookState.bookId, bookId)
        )
      );
  } else {
    await db.insert(userBookState).values({
      userId,
      bookId,
      state,
    });
  }

  // 2. Update or create the reading session
  const activeSession = await getActiveSession(userId, bookId);

  if (activeSession) {
    // Complete the active session — preserve activeFormats as a record of how it was read.
    // Since the user was actively reading, default the finish date to today if they
    // didn't pick one (they most likely just finished today).
    const today = new Date().toISOString().split("T")[0];

    // Determine final activeFormats: prefer whatever's already on the session,
    // otherwise fall back to the cached selection from user_book_state.
    //
    // getActiveSession() returns activeFormats already parsed to a string[], so
    // it MUST be re-serialized with JSON.stringify before it goes into the text
    // column. Assigning a JS array straight to a text column coerces it via
    // String() to a bare value like "paperback" (single element) or throws
    // "Too many parameter values" (multi element). A bare "paperback" is not
    // valid JSON, so every reader that JSON.parse()s it later threw — this was
    // the root cause of the "Something went wrong" crash on finished books.
    // cachedFormats is already a JSON string (or null) from user_book_state.
    const finalFormats =
      activeSession.activeFormats.length > 0
        ? JSON.stringify(activeSession.activeFormats)
        : cachedFormats;

    // If the user picked a completion date that's before the recorded start
    // date, the recorded start can't be right — drop it so the UI shows
    // "No start date" instead of an impossible timeline (e.g. "Apr 27, 2026 → 2024").
    let startedAtUpdate: { startedAtExplicit?: boolean } = {};
    if (
      completionDate &&
      activeSession.startedAt &&
      activeSession.startedAt.split("T")[0] > completionDate
    ) {
      startedAtUpdate = { startedAtExplicit: false };
    }

    // If the active session was paused, accumulate the time it spent in the
    // paused state into total_paused_days so stats only count Reading-Now days.
    let pausedUpdate: { totalPausedDays?: number; pausedAt?: string | null } = {};
    if (activeSession.state === "paused" && activeSession.pausedAt) {
      const pausedMs = Date.now() - new Date(activeSession.pausedAt).getTime();
      const additionalPausedDays = Math.max(0, Math.round(pausedMs / (1000 * 60 * 60 * 24)));
      const totalPaused = (activeSession.totalPausedDays ?? 0) + additionalPausedDays;
      pausedUpdate = { totalPausedDays: totalPaused, pausedAt: null };
    }

    await db
      .update(readingSessions)
      .set({
        state,
        completionDate: completionDate ?? today,
        completionPrecision: completionPrecision ?? "exact",
        activeFormats: finalFormats,
        ...startedAtUpdate,
        ...pausedUpdate,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(readingSessions.id, activeSession.id));
  } else {
    // No active session — create one (e.g., user clicked "Finished" directly without "Reading Now" first).
    // The user never indicated a start OR finish date; leave both unspecified if they skipped.
    // Preserve any cached format selection (user_book_state.activeFormats) so
    // stats know how the book was read.
    const readNumber = await getNextReadNumber(userId, bookId);
    await db.insert(readingSessions).values({
      userId,
      bookId,
      readNumber,
      state,
      startedAt: new Date().toISOString(),
      startedAtExplicit: false,
      completionDate,
      completionPrecision,
      activeFormats: cachedFormats,
    });
  }
}
