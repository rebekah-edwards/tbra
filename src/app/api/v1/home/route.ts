import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getReadingNow } from "@/lib/queries/reading-now";
import { getReadingGoal } from "@/lib/queries/reading-goals";
import { getReadingStreak } from "@/lib/queries/reading-streak";
import { getDisplayPrefs } from "@/lib/queries/display-prefs";
import { getRandomOwnedTbrBook } from "@/lib/queries/tbr-suggestion";

/**
 * GET /api/v1/home
 * The signed-in user's home-page data: Reading Now (with latest progress %
 * and active buddy read), reading goal, and tbr streak. Mirrors the exact
 * queries + progress derivation of the web home page (src/app/page.tsx).
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const currentYear = new Date().getFullYear();

  const [readingNow, readingGoal, readingStreak, tbrSuggestion, display] = await Promise.all([
    getReadingNow(user.userId),
    getReadingGoal(user.userId, currentYear),
    getReadingStreak(user.userId),
    getRandomOwnedTbrBook(user.userId),
    getDisplayPrefs(user.userId),
  ]);

  return jsonOk({
    year: currentYear,
    readingNow,
    goal: readingGoal, // { targetBooks, completedBooks, percentComplete } | null
    streak: {
      currentStreak: readingStreak.currentStreak,
      longestStreak: readingStreak.longestStreak,
      // Drives the "Today / Not yet" status on the streak tile.
      activeToday: readingStreak.activeToday,
    },
    tbrSuggestion, // { id, slug, title, coverImageUrl, authors, reason } | null
    // The reader switched these off (Settings, or "hide" on the tile). The
    // numbers above are still sent so switching back on needs no refetch.
    hideGoal: display.hideGoal,
    hideStreak: display.hideStreak,
  });
}
