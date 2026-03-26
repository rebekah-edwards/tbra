import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Reading Stats | The Based Reader App",
  description: "Track detailed statistics to better understand your reading habits on tbr*a.",
  robots: { index: false },
};
import { getReadingGoal } from "@/lib/queries/reading-goals";
import { getReadingStreak } from "@/lib/queries/reading-streak";
import {
  getCompletedBooksByMonth,
  getPagesByMonth,
  getGenreBreakdown,
  getRatingDistribution,
  getMostReadAuthors,
  getReadingPace,
  getPageStats,
  getMinutesListened,
  getFictionNonfictionSplit,
} from "@/lib/queries/stats-detailed";
import { StatsClient } from "./stats-client";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const selectedYear = params.year === "all" ? undefined : parseInt(params.year ?? String(currentYear), 10);
  const yearLabel = selectedYear ?? "all";

  const [
    goal,
    streak,
    booksByMonth,
    pagesByMonth,
    genreBreakdown,
    ratingDistribution,
    mostReadAuthors,
    readingPace,
    pageStats,
    minutesListened,
    fictionSplit,
  ] = await Promise.all([
    getReadingGoal(session.userId, selectedYear ?? currentYear),
    getReadingStreak(session.userId, selectedYear ?? undefined),
    getCompletedBooksByMonth(session.userId, selectedYear),
    getPagesByMonth(session.userId, selectedYear),
    getGenreBreakdown(session.userId, selectedYear),
    getRatingDistribution(session.userId, selectedYear),
    getMostReadAuthors(session.userId, 8, selectedYear),
    getReadingPace(session.userId, selectedYear),
    getPageStats(session.userId, selectedYear),
    getMinutesListened(session.userId, selectedYear),
    getFictionNonfictionSplit(session.userId, selectedYear),
  ]);

  return (
    <StatsClient
      year={yearLabel}
      currentYear={currentYear}
      goal={goal}
      streak={streak}
      booksByMonth={booksByMonth}
      pagesByMonth={pagesByMonth}
      genreBreakdown={genreBreakdown}
      ratingDistribution={ratingDistribution}
      mostReadAuthors={mostReadAuthors}
      readingPace={readingPace}
      pageStats={pageStats}
      minutesListened={minutesListened}
      fictionSplit={fictionSplit}
    />
  );
}
