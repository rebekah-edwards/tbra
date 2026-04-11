import { db } from "@/db";
import { readingSessions } from "@/db/schema";
import { eq, and, or, desc, count, sql } from "drizzle-orm";

export interface ReadingSession {
  id: string;
  readNumber: number;
  state: string;
  startedAt: string;
  startedAtExplicit: boolean;
  completionDate: string | null;
  completionPrecision: string | null;
  activeFormats: string[];
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseSession(row: typeof readingSessions.$inferSelect): ReadingSession {
  return {
    id: row.id,
    readNumber: row.readNumber,
    state: row.state,
    startedAt: row.startedAt,
    startedAtExplicit: row.startedAtExplicit ?? false,
    completionDate: row.completionDate,
    completionPrecision: row.completionPrecision,
    activeFormats: row.activeFormats ? JSON.parse(row.activeFormats) : [],
    pausedAt: row.pausedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Get the active (currently_reading or paused) session, or null */
export async function getActiveSession(
  userId: string,
  bookId: string
): Promise<ReadingSession | null> {
  const row = await db
    .select()
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        eq(readingSessions.bookId, bookId),
        or(
          eq(readingSessions.state, "currently_reading"),
          eq(readingSessions.state, "paused")
        )
      )
    )
    .orderBy(desc(readingSessions.readNumber))
    .limit(1)
    .get();

  return row ? parseSession(row) : null;
}

/** Get the most recent session by readNumber, regardless of state */
export async function getLatestSession(
  userId: string,
  bookId: string
): Promise<ReadingSession | null> {
  const row = await db
    .select()
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        eq(readingSessions.bookId, bookId)
      )
    )
    .orderBy(desc(readingSessions.readNumber))
    .limit(1)
    .get();

  return row ? parseSession(row) : null;
}

/** Check if user has at least one completed or dnf session — used for review gate */
export async function hasCompletedSession(
  userId: string,
  bookId: string
): Promise<boolean> {
  const row = await db
    .select({ cnt: count() })
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        eq(readingSessions.bookId, bookId),
        or(
          eq(readingSessions.state, "completed"),
          eq(readingSessions.state, "dnf")
        )
      )
    )
    .get();

  return (row?.cnt ?? 0) > 0;
}

/** Count completed sessions (not dnf) — for "read X times" display */
export async function getReadCount(
  userId: string,
  bookId: string
): Promise<number> {
  const row = await db
    .select({ cnt: count() })
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        eq(readingSessions.bookId, bookId),
        eq(readingSessions.state, "completed")
      )
    )
    .get();

  return row?.cnt ?? 0;
}

/** Get all sessions for a user-book pair, ordered by readNumber asc */
export async function getBookSessions(
  userId: string,
  bookId: string
): Promise<ReadingSession[]> {
  const rows = await db
    .select()
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        eq(readingSessions.bookId, bookId)
      )
    )
    .orderBy(readingSessions.readNumber)
    .all();

  return rows.map(parseSession);
}

/** Get the most recent completed/dnf session — for "last read via" display */
export async function getLastCompletedSession(
  userId: string,
  bookId: string
): Promise<ReadingSession | null> {
  const row = await db
    .select()
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        eq(readingSessions.bookId, bookId),
        or(
          eq(readingSessions.state, "completed"),
          eq(readingSessions.state, "dnf")
        )
      )
    )
    .orderBy(desc(readingSessions.readNumber))
    .limit(1)
    .get();

  return row ? parseSession(row) : null;
}

/**
 * Combined session data for book page — replaces 3 separate queries
 * (getBookSessions + hasCompletedSession + getLastCompletedSession)
 * with a single DB query.
 */
export async function getBookSessionData(
  userId: string,
  bookId: string,
): Promise<{
  sessions: ReadingSession[];
  hasCompleted: boolean;
  lastCompletedSession: ReadingSession | null;
}> {
  const rows = await db
    .select()
    .from(readingSessions)
    .where(and(eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId)))
    .orderBy(readingSessions.readNumber)
    .all();

  const sessions = rows.map(parseSession);
  const completedOrDnf = sessions.filter((s) => s.state === "completed" || s.state === "dnf");
  const hasCompleted = completedOrDnf.length > 0;
  const lastCompletedSession = completedOrDnf.length > 0
    ? completedOrDnf[completedOrDnf.length - 1]
    : null;

  return { sessions, hasCompleted, lastCompletedSession };
}

/** Get the next read number for a new session */
export async function getNextReadNumber(
  userId: string,
  bookId: string
): Promise<number> {
  const latest = await getLatestSession(userId, bookId);
  return latest ? latest.readNumber + 1 : 1;
}
