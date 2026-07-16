import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getReadingGoal } from "@/lib/queries/reading-goals";
import { getReadingStreak } from "@/lib/queries/reading-streak";
import {
  getCompletedBooksByMonth,
  getCompletedBooksByYear,
  getPagesByMonth,
  getGenreBreakdown,
  getRatingDistribution,
  getMostReadAuthors,
  getReadingPace,
  getPageStats,
  getMinutesListened,
  getFictionNonfictionSplit,
} from "@/lib/queries/stats-detailed";

/**
 * GET /api/v1/stats?year=2026|all
 * The Reading Stats page payload — the exact query set of /stats.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const currentYear = new Date().getFullYear();
  const selectedYear = yearParam === "all" ? undefined : parseInt(yearParam ?? String(currentYear), 10);

  const [
    goal, streak, booksByMonth, booksByYear, pagesByMonth,
    genreBreakdown, ratingDistribution, mostReadAuthors,
    readingPace, pageStats, minutesListened, fictionSplit,
  ] = await Promise.all([
    getReadingGoal(user.userId, selectedYear ?? currentYear),
    getReadingStreak(user.userId, selectedYear ?? undefined),
    getCompletedBooksByMonth(user.userId, selectedYear),
    selectedYear === undefined ? getCompletedBooksByYear(user.userId) : Promise.resolve([]),
    getPagesByMonth(user.userId, selectedYear),
    getGenreBreakdown(user.userId, selectedYear),
    getRatingDistribution(user.userId, selectedYear),
    getMostReadAuthors(user.userId, 8, selectedYear),
    getReadingPace(user.userId, selectedYear),
    getPageStats(user.userId, selectedYear),
    getMinutesListened(user.userId, selectedYear),
    getFictionNonfictionSplit(user.userId, selectedYear),
  ]);

  return jsonOk({
    currentYear,
    goal,
    streak: { currentStreak: streak.currentStreak, longestStreak: streak.longestStreak },
    booksByMonth,
    booksByYear,
    pagesByMonth,
    genreBreakdown,
    ratingDistribution,
    mostReadAuthors,
    readingPace,
    pageStats,
    minutesListened,
    fictionSplit,
  });
}
