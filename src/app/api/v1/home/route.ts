import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getReadingNow } from "@/lib/queries/reading-now";
import { getReadingGoal } from "@/lib/queries/reading-goals";
import { getReadingStreak } from "@/lib/queries/reading-streak";
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

  const [readingNow, readingGoal, readingStreak, tbrSuggestion] = await Promise.all([
    getReadingNow(user.userId),
    getReadingGoal(user.userId, currentYear),
    getReadingStreak(user.userId),
    getRandomOwnedTbrBook(user.userId),
  ]);

  return jsonOk({
    year: currentYear,
    readingNow,
    goal: readingGoal, // { targetBooks, completedBooks, percentComplete } | null
    streak: { currentStreak: readingStreak.currentStreak, longestStreak: readingStreak.longestStreak },
    tbrSuggestion, // { id, slug, title, coverImageUrl, authors, reason } | null
  });
}
