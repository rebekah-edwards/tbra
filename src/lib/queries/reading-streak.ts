import { db } from "@/db";
import { readingNotes, userBookState, readingSessions, userBookReviews, userBookRatings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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
export async function getReadingStreak(userId: string, year?: number): Promise<ReadingStreak> {
  // Collect all interaction dates from multiple tables using UNION
  // Each subquery extracts the date portion (YYYY-MM-DD) of timestamps
  // Optionally filter to a specific year
  const yearFilter = year ? sql`AND strftime('%Y', created_at) = ${String(year)}` : sql``;
  const yearFilterUpdated = year ? sql`AND strftime('%Y', updated_at) = ${String(year)}` : sql``;

  const result = await db.all<{ d: string }>(sql`
    SELECT DISTINCT date(created_at) AS d FROM reading_notes WHERE user_id = ${userId} ${yearFilter}
    UNION
    SELECT DISTINCT date(updated_at) AS d FROM user_book_state WHERE user_id = ${userId} ${yearFilterUpdated}
    UNION
    SELECT DISTINCT date(updated_at) AS d FROM reading_sessions WHERE user_id = ${userId} ${yearFilterUpdated}
    UNION
    SELECT DISTINCT date(created_at) AS d FROM reading_sessions WHERE user_id = ${userId} ${yearFilter}
    UNION
    SELECT DISTINCT date(created_at) AS d FROM user_book_reviews WHERE user_id = ${userId} ${yearFilter}
    UNION
    SELECT DISTINCT date(updated_at) AS d FROM user_book_reviews WHERE user_id = ${userId} ${yearFilterUpdated}
    UNION
    SELECT DISTINCT date(updated_at) AS d FROM user_book_ratings WHERE user_id = ${userId} ${yearFilterUpdated}
    ORDER BY d
  `);

  const days = result.map((r) => r.d).filter(Boolean);

  if (days.length === 0) {
    return { currentStreak: 0, longestStreak: 0, unit: "days" };
  }

  // Calculate streaks by checking consecutive dates
  let longestStreak = 1;
  let currentRun = 1;

  for (let i = 1; i < days.length; i++) {
    if (areConsecutiveDays(days[i - 1], days[i])) {
      currentRun++;
      longestStreak = Math.max(longestStreak, currentRun);
    } else if (days[i] !== days[i - 1]) {
      // Not consecutive and not same day — reset
      currentRun = 1;
    }
  }

  // Check if current streak is still active (today or yesterday)
  const now = new Date();
  const todayStr = formatDateLocal(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDateLocal(yesterday);

  const lastActiveDay = days[days.length - 1];

  let currentStreak = 0;
  if (lastActiveDay === todayStr || lastActiveDay === yesterdayStr) {
    // Walk backwards from end to count current streak
    currentStreak = 1;
    for (let i = days.length - 2; i >= 0; i--) {
      if (areConsecutiveDays(days[i], days[i + 1])) {
        currentStreak++;
      } else if (days[i] !== days[i + 1]) {
        break;
      }
    }
  }

  return { currentStreak, longestStreak, unit: "days" };
}

/** Format a Date as YYYY-MM-DD in local time */
function formatDateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Check if two YYYY-MM-DD date strings are consecutive calendar days */
function areConsecutiveDays(day1: string, day2: string): boolean {
  const d1 = new Date(day1 + "T00:00:00");
  const d2 = new Date(day2 + "T00:00:00");
  const diff = d2.getTime() - d1.getTime();
  return diff === 86400000; // exactly 1 day in ms
}
