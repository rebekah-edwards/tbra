import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isPremium, isAdmin } from "@/lib/auth";
import { getMissingBookMetadata } from "@/lib/queries/missing-book-metadata";
import { getCustomGoals, getLibraryGenres } from "@/lib/queries/custom-goals";

export const metadata: Metadata = {
  title: "Reading Stats | The Based Reader App",
  description: "Track detailed statistics to better understand your reading habits on tbr*a.",
  robots: { index: false },
};
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
import { StatsClient } from "./stats-client";
import { getDisplayPrefs } from "@/lib/queries/display-prefs";

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
    booksByYear,
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
    // Only fetch the yearly aggregation when All Time is selected.
    selectedYear === undefined
      ? getCompletedBooksByYear(session.userId)
      : Promise.resolve([]),
    getPagesByMonth(session.userId, selectedYear),
    getGenreBreakdown(session.userId, selectedYear),
    getRatingDistribution(session.userId, selectedYear),
    getMostReadAuthors(session.userId, 8, selectedYear),
    getReadingPace(session.userId, selectedYear),
    getPageStats(session.userId, selectedYear),
    getMinutesListened(session.userId, selectedYear),
    getFictionNonfictionSplit(session.userId, selectedYear),
  ]);

  const display = await getDisplayPrefs(session.userId);

  // How many of this year's reads lack a page count / audio length — drives
  // the warning icons (admins → /admin/book-metadata).
  // Based Readers see the same warning, counting only books they haven't
  // entered a number for yet; theirs link to /stats/missing.
  const admin = isAdmin(session);
  const adminMissing =
    (admin || isPremium(session)) && selectedYear !== undefined
      ? await getMissingBookMetadata(session.userId, selectedYear).then((m) => ({
          year: selectedYear,
          pages: admin ? m.pages.length : m.pages.filter((b) => !b.ownPages).length,
          audio: admin ? m.audio.length : m.audio.filter((b) => !b.ownMinutes).length,
          personal: !admin,
        }))
      : null;

  // Premium custom goals — per year, so not shown on All Time.
  const premium = isPremium(session);
  const [customGoals, libraryGenres] =
    premium && selectedYear !== undefined
      ? await Promise.all([
          getCustomGoals(session.userId, selectedYear),
          selectedYear === currentYear ? getLibraryGenres(session.userId) : Promise.resolve([]),
        ])
      : [[], []];

  return (
    <StatsClient
      year={yearLabel}
      currentYear={currentYear}
      // Hidden by the reader (Settings → Display): hidden here too.
      goal={display.hideGoal ? null : goal}
      streak={streak}
      hideStreak={display.hideStreak}
      booksByMonth={booksByMonth}
      booksByYear={booksByYear}
      pagesByMonth={pagesByMonth}
      genreBreakdown={genreBreakdown}
      ratingDistribution={ratingDistribution}
      mostReadAuthors={mostReadAuthors}
      readingPace={readingPace}
      pageStats={pageStats}
      minutesListened={minutesListened}
      fictionSplit={fictionSplit}
      premium={premium}
      customGoals={customGoals}
      libraryGenres={libraryGenres}
      adminMissing={adminMissing}
    />
  );
}
