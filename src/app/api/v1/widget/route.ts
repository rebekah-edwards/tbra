import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getReadingGoal } from "@/lib/queries/reading-goals";
import { getReadingStreak } from "@/lib/queries/reading-streak";
import { getReadingNow } from "@/lib/queries/reading-now";
import {
  getGenreBreakdown,
  getReadingPace,
  getPageStats,
  getMinutesListened,
} from "@/lib/queries/stats-detailed";

/**
 * GET /api/v1/widget
 * Everything the home-screen / Lock Screen widgets draw, in one call.
 *
 * Separate from /api/v1/home because the widget needs a different mix: no
 * discover rails or TBR suggestion (it never shows them), but the four
 * year-to-date stats from the Stats page that the large widget does show.
 * Keeping it its own endpoint means the widget's refresh — which runs on a
 * background timeline budget — never pays for payload it can't render.
 *
 * The book list is deliberately trimmed to 4: the largest widget draws at
 * most 3 plus a "+N" count, so anything beyond that is wasted bytes and
 * wasted cover downloads.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const year = new Date().getFullYear();

  const [readingNow, goal, streak, genres, pace, pageStats, minutesListened] =
    await Promise.all([
      getReadingNow(user.userId),
      getReadingGoal(user.userId, year),
      getReadingStreak(user.userId),
      getGenreBreakdown(user.userId, year),
      getReadingPace(user.userId, year),
      getPageStats(user.userId, year),
      getMinutesListened(user.userId, year),
    ]);

  return jsonOk({
    year,
    totalReading: readingNow.length,
    readingNow: readingNow.slice(0, 4).map((b) => ({
      id: b.id,
      slug: b.slug,
      title: b.title,
      coverImageUrl: b.coverImageUrl,
      usesAudiobookCover: b.usesAudiobookCover,
      authors: b.authors,
      pages: b.pages,
      audioLengthMinutes: b.audioLengthMinutes,
      activeFormats: b.activeFormats,
      progress: b.progress,
    })),
    goal,
    streak: {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
    },
    stats: {
      // Name AND count: the large widget draws the Stats page's donut, which
      // needs each slice's share. Five slices — six crowds a quadrant legend.
      topGenres: genres.slice(0, 5).map((g) => ({ genre: g.genre, count: g.count })),
      // avgDays is null until at least one book has both a start and a
      // completion date — the widget hides the row rather than showing 0.
      avgDaysPerBook: pace?.avgDays != null ? Math.round(pace.avgDays) : null,
      booksThisYear: pageStats.bookCount,
      pagesThisYear: pageStats.totalPages,
      minutesListened,
    },
  });
}
