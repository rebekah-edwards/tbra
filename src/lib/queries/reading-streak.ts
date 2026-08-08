import { db } from "@/db";
import { readingNotes, userBookState, readingSessions, userBookReviews, userBookRatings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

export interface ReadingStreak {
  currentStreak: number;
  longestStreak: number;
  unit: "days";
}

/**
 * Calculate daily reading streaks.
 * A "streak day" is any calendar day where the user had at least one reading interaction:
 * - Added/updated a reading note
 * - Changed a book's reading state
 * - Started/updated a reading session
 * - Wrote or updated a review
 * - Rated a book
 *
 * Consecutive calendar days form a streak.
 */
/**
 * Calendar days are bucketed in the READER'S OWN timezone, not UTC and not the
 * server's local time (which is UTC on Vercel anyway).
 *
 * Timestamps are stored as UTC, so a reader acting at 11pm Eastern was being
 * credited to the NEXT calendar day. That silently punched holes in streaks:
 * on 2026-08-08 Rebekah's real Eastern run was 5 days (Aug 4-8) but UTC
 * bucketing scored it 2, because her Aug 5 evening activity landed on Aug 6
 * UTC and her Aug 6 had none of its own.
 *
 * users.timezone is reported by the client on sign-in. Readers who haven't
 * checked in since the column shipped fall back to this default rather than
 * to UTC, which would reintroduce the bug for them.
 */
const FALLBACK_TIMEZONE = "America/New_York";

/** Intl formatters are expensive to build; one per zone is plenty. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dayFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // Unknown/garbage identifier — never let it throw the whole page.
    fmt = dayFormatterFor(FALLBACK_TIMEZONE);
  }
  formatterCache.set(timeZone, fmt);
  return fmt;
}

/** UTC timestamp (ISO or "YYYY-MM-DD HH:MM:SS") → YYYY-MM-DD in `timeZone`. */
function toStreakDay(raw: string, fmt: Intl.DateTimeFormat): string | null {
  let s = String(raw).trim().replace(" ", "T");
  // Naive timestamps are stored as UTC; mark them so Date doesn't read them
  // as server-local.
  if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return fmt.format(d);
}

export async function getReadingStreak(userId: string, year?: number): Promise<ReadingStreak> {
  return unstable_cache(
    () => getReadingStreakInner(userId, year),
    [`reading-streak-${userId}-${year ?? "all"}`],
    // Was 3600. An hour-long cache meant today's activity took up to an hour
    // to show, and Home and Stats — separate cache entries — could hold
    // different values at the same moment, which is how the same account read
    // 3 days on Home and 0 on Stats.
    { revalidate: 60 }
  )();
}

async function getReadingStreakInner(userId: string, year?: number): Promise<ReadingStreak> {
  const tzRow = (await db.all(sql`
    SELECT timezone FROM users WHERE id = ${userId}
  `)) as { timezone: string | null }[];
  const fmt = dayFormatterFor(tzRow[0]?.timezone || FALLBACK_TIMEZONE);

  // Hour precision keeps the row count sane for big libraries (a Goodreads
  // import stamps thousands of rows within the same hour) while staying fine
  // enough to bucket into a local calendar day.
  const hourOf = (col: string) => sql.raw(`substr(replace(${col}, ' ', 'T'), 1, 13)`);

  const result = (await db.all(sql`
    SELECT DISTINCT ${hourOf("created_at")} AS t FROM reading_notes WHERE user_id = ${userId}
    UNION
    SELECT DISTINCT ${hourOf("updated_at")} AS t FROM user_book_state WHERE user_id = ${userId}
    UNION
    SELECT DISTINCT ${hourOf("updated_at")} AS t FROM reading_sessions WHERE user_id = ${userId}
    UNION
    SELECT DISTINCT ${hourOf("created_at")} AS t FROM reading_sessions WHERE user_id = ${userId}
    UNION
    SELECT DISTINCT ${hourOf("created_at")} AS t FROM user_book_reviews WHERE user_id = ${userId}
    UNION
    SELECT DISTINCT ${hourOf("updated_at")} AS t FROM user_book_reviews WHERE user_id = ${userId}
    UNION
    SELECT DISTINCT ${hourOf("updated_at")} AS t FROM user_book_ratings WHERE user_id = ${userId}
  `)) as { t: string | null }[];

  const allDays: string[] = [
    ...new Set(
      result
        .map((r) => (r.t ? toStreakDay(`${r.t}:00:00`, fmt) : null))
        .filter((d): d is string => Boolean(d))
    ),
  ].sort();

  if (allDays.length === 0) {
    return { currentStreak: 0, longestStreak: 0, unit: "days" };
  }

  // longestStreak honours the Stats year picker; currentStreak NEVER does — a
  // "current streak" is by definition anchored to today, and year-filtering it
  // was the other half of the Home/Stats disagreement (Home passed no year,
  // Stats passed one, so the two pages computed different things).
  const scopedDays = year
    ? allDays.filter((d) => d.startsWith(`${year}-`))
    : allDays;

  let longestStreak = scopedDays.length > 0 ? 1 : 0;
  let currentRun = 1;
  for (let i = 1; i < scopedDays.length; i++) {
    if (areConsecutiveDays(scopedDays[i - 1], scopedDays[i])) {
      currentRun++;
      longestStreak = Math.max(longestStreak, currentRun);
    } else {
      currentRun = 1;
    }
  }

  const now = new Date();
  const todayStr = fmt.format(now);
  const yesterdayStr = fmt.format(new Date(now.getTime() - 86_400_000));
  const lastActiveDay = allDays[allDays.length - 1];

  let currentStreak = 0;
  if (lastActiveDay === todayStr || lastActiveDay === yesterdayStr) {
    currentStreak = 1;
    for (let i = allDays.length - 2; i >= 0; i--) {
      if (areConsecutiveDays(allDays[i], allDays[i + 1])) currentStreak++;
      else break;
    }
  }

  return { currentStreak, longestStreak, unit: "days" };
}

/** Check if two YYYY-MM-DD date strings are consecutive calendar days */
function areConsecutiveDays(day1: string, day2: string): boolean {
  const d1 = new Date(day1 + "T00:00:00");
  const d2 = new Date(day2 + "T00:00:00");
  const diff = d2.getTime() - d1.getTime();
  return diff === 86400000; // exactly 1 day in ms
}
