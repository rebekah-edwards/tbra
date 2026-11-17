"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GoalRingTick, PacePill, paceLine } from "@/components/home/reading-goal-card";
import { useRouter } from "next/navigation";
import type { ReadingGoalProgress } from "@/lib/queries/reading-goals";
import type { ReadingStreak } from "@/lib/queries/reading-streak";
import { ReadingStreakCard } from "@/components/home/reading-streak-card";

interface StatsClientProps {
  year: number | "all";
  currentYear: number;
  goal: ReadingGoalProgress | null;
  streak: ReadingStreak;
  /** The reader hid the streak (Settings → Display). */
  hideStreak?: boolean;
  booksByMonth: { month: string; count: number }[];
  booksByYear: { year: string | null; count: number; pages: number }[];
  pagesByMonth: { month: string; pages: number }[];
  genreBreakdown: { genre: string; count: number }[];
  ratingDistribution: { bucket: string; count: number }[];
  mostReadAuthors: { author: string; count: number }[];
  readingPace: { avgDays: number; totalBooks: number } | null;
  pageStats: { totalPages: number; bookCount: number };
  minutesListened: number;
  fictionSplit: { fiction: number; nonfiction: number };
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remaining = mins % 60;
  if (remaining === 0) return `${hrs}h`;
  return `${hrs}h ${remaining}m`;
}

// Neon palette for charts
const CHART_COLORS = [
  "var(--accent)",       // lime
  "var(--neon-purple)",  // purple
  "var(--neon-blue)",    // blue
  "#fb923c",             // orange
  "#f472b6",             // pink
  "#34d399",             // emerald
];

export function StatsClient({
  year,
  currentYear,
  goal,
  streak,
  hideStreak = false,
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
}: StatsClientProps) {
  const router = useRouter();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2, "all"] as const;

  function selectYear(y: typeof yearOptions[number]) {
    router.push(y === "all" ? "/stats?year=all" : `/stats?year=${y}`);
  }

  const totalFictionNonfiction = fictionSplit.fiction + fictionSplit.nonfiction;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const isAllTime = year === "all";

  // Today's place in the goal's year. Read after mount, not during render:
  // the server's "today" (UTC) and the reader's can differ by a day, which
  // would mismatch the "N days left" text on hydration.
  const [yearProgress, setYearProgress] = useState<{ elapsed: number; daysLeft: number } | null>(null);
  useEffect(() => {
    const now = new Date();
    if (!(year === "all" || year === now.getFullYear())) return setYearProgress(null);
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
    const days = Math.round((end - start) / 86_400_000);
    const day = Math.floor((now.getTime() - start) / 86_400_000) + 1;
    setYearProgress({ elapsed: day / days, daysLeft: days - day });
  }, [year]);
  // All Time shows one bar per tracked year (plus "No Year" for completions
  // with no date). Year-specific views show one bar per month.
  const chartData = isAllTime
    ? booksByYear.map((r) => ({
        label: r.year ?? "No Year",
        books: r.count,
        pages: r.pages,
      }))
    : buildMonthlyData(booksByMonth, pagesByMonth, year, currentYear, monthNames);
  const maxMonthlyBooks = Math.max(...chartData.map((m) => m.books), 1);
  const maxRatingCount = Math.max(...ratingDistribution.map((r) => r.count), 1);
  const topGenres = genreBreakdown.slice(0, 6);
  const totalGenreBooks = topGenres.reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="space-y-6 lg:max-w-[60%] lg:mx-auto">
      {/* Page heading */}
      <h1
        className="text-foreground text-2xl font-bold tracking-tight mb-2"
       
      >
        Reading Stats
      </h1>

      {/* Year Selector — pill buttons */}
      <div className="flex gap-2 justify-center">
        {yearOptions.map((y) => (
          <button
            key={y}
            onClick={() => selectYear(y)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              String(year) === String(y)
                ? "bg-accent/20 text-accent border border-accent/30"
                : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
            }`}
          >
            {y === "all" ? "All Time" : y}
          </button>
        ))}
      </div>

      {/* ─── Hero Stat Cards ─── */}
      <div className="grid grid-cols-3 gap-3">
        <HeroCard
          icon="📚"
          iconBg="bg-neon-purple/20"
          value={String(pageStats.bookCount)}
          label="Books"
          href={typeof year === "number"
            ? `/library?tab=activity&filter=completed&year=${year}`
            : "/library?tab=activity&filter=completed"
          }
        />
        {!hideStreak && (
          <HeroCard
            icon="🔥"
            iconBg="bg-orange-500/20"
            value={streak.currentStreak > 0 ? `${streak.currentStreak}` : "—"}
            label={streak.currentStreak === 1 ? "Day streak" : "Day streak"}
          />
        )}
        <HeroCard
          icon="⭐"
          iconBg="bg-yellow-500/15"
          value={ratingDistribution.length > 0
            ? (() => {
                let total = 0, count = 0;
                for (const r of ratingDistribution) {
                  total += parseFloat(r.bucket) * r.count;
                  count += r.count;
                }
                return count > 0 ? (total / count).toFixed(1) : "—";
              })()
            : "—"
          }
          label="Avg rating"
        />
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat value={pageStats.totalPages >= 10000 ? `${(pageStats.totalPages / 1000).toFixed(1)}k` : pageStats.totalPages.toLocaleString()} label="Pages read" />
        <MiniStat value={readingPace ? `${readingPace.avgDays}d` : "—"} label="Avg pace" />
        <MiniStat value={minutesListened > 0 ? formatMinutes(minutesListened) : "—"} label="Listened" />
      </div>

      {/* ─── Row 1: Reading Goal + Streak, then Monthly Reading ───
          Goal and streak share a row so the goal card has room for a full
          line of numbers (in a third of the row "of 65 books" and the pace
          pill both wrapped) and the streak gets what the Home tile shows. */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-4 space-y-6 lg:space-y-0">
        {goal && (
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="section-heading text-xs mb-4">Reading Goal</h2>
            {/* Design refresh 2026-11: same lime→blue ring, big count and
                pace pill as the Home goal tile. */}
            <div className="flex items-center gap-5">
              <div className="relative w-24 h-24 flex-shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 drop-shadow-[0_0_6px_rgba(163,230,53,0.45)]">
                  <defs>
                    <linearGradient id="stats-goal-ring" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#a3e635" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                  </defs>
                  <circle cx="50" cy="50" r="41" fill="none" stroke="currentColor" strokeWidth="10" className="text-foreground/10" />
                  <circle cx="50" cy="50" r="41" fill="none" stroke="url(#stats-goal-ring)" strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 41}`}
                    strokeDashoffset={`${2 * Math.PI * 41 * (1 - Math.max(2, Math.min(goal.percentComplete, 100)) / 100)}`}
                    className="transition-all duration-700" />
                </svg>
                {/* Today's place in the year, on the ring itself — the iOS
                    ring has it; this one only had the tick on the track below. */}
                {yearProgress && (
                  <GoalRingTick elapsed={yearProgress.elapsed} viewBox={100} radius={41} strokeWidth={10} />
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold font-heading tabular-nums">{goal.percentComplete}%</span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div>
                    <p className="font-heading text-[40px] font-extrabold leading-none tabular-nums">{goal.completedBooks}</p>
                    <p className="mt-1 whitespace-nowrap text-sm text-muted">of {goal.targetBooks} books</p>
                  </div>
                  {(() => {
                    const pace = paceLine(goal, typeof year === "number" ? year : new Date().getFullYear());
                    return <PacePill pace={pace} />;
                  })()}
                </div>
                {/* Goal progress against a tick for today's place in the
                    year: fill past the tick is ahead of pace. */}
                <div className="relative mt-3.5 h-3.5">
                  <div className="absolute inset-x-0 top-1/2 h-[7px] -translate-y-1/2 overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(goal.percentComplete > 0 ? 3 : 0, Math.min(goal.percentComplete, 100))}%`,
                        background: "linear-gradient(90deg, #a3e635, #38bdf8)",
                      }}
                    />
                  </div>
                  {yearProgress && (
                    <span
                      aria-hidden
                      className="absolute top-0 h-full w-[2px] rounded-full bg-foreground"
                      style={{ left: `calc(${Math.min(yearProgress.elapsed * 100, 100)}% - 1px)` }}
                    />
                  )}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-medium text-muted">
                  <span className="whitespace-nowrap">{goal.percentComplete}% of goal</span>
                  {yearProgress && (
                    <span className="whitespace-nowrap">
                      {yearProgress.daysLeft} {yearProgress.daysLeft === 1 ? "day" : "days"} left
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
        {(year === currentYear || isAllTime) && !hideStreak && (
          <div className={goal ? "" : "lg:col-span-2"}>
            <ReadingStreakCard streak={streak} wide />
          </div>
        )}
        {chartData.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
            <h2 className="section-heading text-xs mb-4">
              {isAllTime ? "Yearly Reading" : "Monthly Reading"}
            </h2>
            <div className="-mx-2 overflow-x-auto px-2 pb-1">
              <div
                className="flex items-end gap-1 h-32"
                style={{ minWidth: isAllTime ? undefined : `${chartData.length * 20}px` }}
              >
                {chartData.map((m) => {
                  const pct = (m.books / maxMonthlyBooks) * 100;
                  const unit = isAllTime ? "year" : "month";
                  return (
                    <div key={m.label} className={`flex-1 ${isAllTime ? "min-w-[40px]" : "min-w-[18px]"} flex flex-col items-center gap-1 group relative`}>
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[9px] px-2 py-1 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {m.books} book{m.books !== 1 ? "s" : ""} · {m.pages.toLocaleString()} pages{isAllTime && m.label === "No Year" ? ` (${unit} untracked)` : ""}
                      </div>
                      <div className="w-full flex justify-center" style={{ height: "100px", alignItems: "flex-end", display: "flex" }}>
                        <div className="w-3/4 rounded-t-md transition-all duration-300"
                          style={{ height: `${Math.max(pct, m.books > 0 ? 6 : 0)}%`, background: "linear-gradient(to top, var(--accent), var(--neon-blue))" }} />
                      </div>
                      <span className="text-[9px] text-muted">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ─── Row 2: Rating Distribution + Fiction vs NF ─── */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-4 space-y-6 lg:space-y-0">
        {ratingDistribution.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
            <h2 className="section-heading text-xs mb-4">Rating Distribution</h2>
            <div className="flex items-end gap-1 h-28">
              {["1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"].map((bucket) => {
                const entry = ratingDistribution.find((r) => r.bucket === bucket);
                const count = entry?.count ?? 0;
                const pct = maxRatingCount > 0 ? (count / maxRatingCount) * 100 : 0;
                return (
                  <div key={bucket} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] text-muted tabular-nums h-3">{count > 0 ? count : ""}</span>
                    <div className="w-full flex justify-center" style={{ height: "72px", alignItems: "flex-end", display: "flex" }}>
                      <div className="w-3/4 rounded-t-md transition-all duration-500"
                        style={{ height: `${Math.max(pct, count > 0 ? 6 : 0)}%`, background: "linear-gradient(to top, var(--neon-blue), var(--accent))" }} />
                    </div>
                    <span className="text-[9px] text-muted">{bucket}★</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {totalFictionNonfiction > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="section-heading text-xs mb-4">Fiction vs Nonfiction</h2>
            {/* Stacked bar with minimum visibility */}
            <div className="h-6 flex rounded-full overflow-hidden mb-3">
              {fictionSplit.fiction > 0 && (
                <div className="transition-all duration-500"
                  style={{ width: `${Math.max((fictionSplit.fiction / totalFictionNonfiction) * 100, 15)}%`, background: "var(--neon-purple)" }} />
              )}
              {fictionSplit.nonfiction > 0 && (
                <div className="transition-all duration-500"
                  style={{ width: `${Math.max((fictionSplit.nonfiction / totalFictionNonfiction) * 100, 15)}%`, background: "var(--neon-blue)" }} />
              )}
            </div>
            {/* Labels below */}
            <div className="flex justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: "var(--neon-purple)" }} />
                <span className="font-medium">{fictionSplit.fiction} Fiction</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: "var(--neon-blue)" }} />
                <span className="font-medium">{fictionSplit.nonfiction} Non-fiction</span>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ─── Row 3: Most Read Authors + Top Genres (50/50) ─── */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-4 space-y-6 lg:space-y-0">
        {mostReadAuthors.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="section-heading text-xs mb-4">Most Read Authors</h2>
            <div className="space-y-2.5">
              {mostReadAuthors.map((a, i) => {
                const pct = mostReadAuthors[0].count > 0 ? (a.count / mostReadAuthors[0].count) * 100 : 0;
                return (
                  <div key={a.author} className="flex items-center gap-3">
                    <span className="text-sm w-5 text-center flex-shrink-0">
                      {i === 0 ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-intensity-2" aria-label="Most read"><path d="M3 7l4.5 4L12 5l4.5 6L21 7l-2 11H5z" /></svg> : <span className="text-xs text-muted">{i + 1}</span>}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium truncate">{a.author}</span>
                        <span className="text-xs text-muted tabular-nums ml-2">{a.count} book{a.count !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="h-1.5 bg-surface-alt rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(pct, 5)}%`, background: i === 0 ? "var(--accent)" : "var(--neon-purple)" }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {genreBreakdown.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="section-heading text-xs mb-4">Top Genres</h2>
            <div className="flex items-center gap-6">
              <div className="relative w-28 h-28 flex-shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  {(() => {
                    const radius = 38;
                    const circumference = 2 * Math.PI * radius;
                    let offset = 0;
                    return topGenres.map((g, i) => {
                      const pct = totalGenreBooks > 0 ? g.count / totalGenreBooks : 0;
                      const dash = pct * circumference;
                      const gap = circumference - dash;
                      const el = (
                        <circle key={g.genre} cx="50" cy="50" r={radius} fill="none"
                          stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth="12"
                          strokeDasharray={`${dash} ${gap}`} strokeDashoffset={`${-offset}`}
                          className="transition-all duration-500" />
                      );
                      offset += dash;
                      return el;
                    });
                  })()}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                  <span className="text-xs font-bold leading-tight line-clamp-2">{genreBreakdown[0]?.genre}</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                {topGenres.map((g, i) => (
                  <div key={g.genre} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="text-xs truncate flex-1">{g.genre}</span>
                    <span className="text-xs text-muted tabular-nums">{g.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Empty state */}
      {booksByMonth.length === 0 && booksByYear.length === 0 && genreBreakdown.length === 0 && ratingDistribution.length === 0 && (
        <div className="rounded-[20px] border border-border bg-surface/60 px-5 py-11 text-center">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-muted" aria-hidden="true">
            <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
          </svg>
          <p className="font-heading text-[19px] font-bold mb-1">No reading data yet</p>
          <p className="text-xs text-muted">Start tracking books to see your stats come alive!</p>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

/** Line icons for the hero tiles (design refresh 2026-11) — same set as the
 *  iOS Stats screen. Anything unrecognised falls back to the glyph passed in. */
function HeroIcon({ icon }: { icon: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (icon === "📚") {
    return (
      <svg {...common} stroke="var(--color-neon-purple)">
        <path d="m16 6 4 14" />
        <path d="M12 6v14" />
        <path d="M8 8v12" />
        <path d="M4 4v16" />
      </svg>
    );
  }
  if (icon === "🔥") {
    return (
      <svg {...common} stroke="#fb923c">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
      </svg>
    );
  }
  if (icon === "⭐") {
    return (
      <svg {...common} stroke="#eab308">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    );
  }
  return <span className="text-lg">{icon}</span>;
}

function HeroCard({ icon, iconBg, value, label, href }: { icon: string; iconBg: string; value: string; label: string; href?: string }) {
  const content = (
    <>
      <div className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center mx-auto mb-2`}>
        <HeroIcon icon={icon} />
      </div>
      <p className="text-2xl font-bold font-heading">{value}</p>
      <p className="text-[10px] text-muted uppercase tracking-wider mt-0.5">{label}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="rounded-2xl border border-border bg-surface p-4 text-center hover:border-accent/30 transition-colors">
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 text-center">
      {content}
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-alt/50 p-2.5 text-center">
      <p className="text-sm font-bold font-heading">{value}</p>
      <p className="text-[9px] text-muted uppercase tracking-wider">{label}</p>
    </div>
  );
}

function buildMonthlyData(
  booksByMonth: { month: string; count: number }[],
  pagesByMonth: { month: string; pages: number }[],
  year: number | "all",
  currentYear: number,
  monthNames: string[]
): { label: string; books: number; pages: number }[] {
  if (year === "all") {
    const allMonths = new Set([
      ...booksByMonth.map((m) => m.month),
      ...pagesByMonth.map((m) => m.month),
    ]);
    const sorted = Array.from(allMonths).sort();
    return sorted.map((month) => {
      const [yr, mo] = month.split("-");
      return {
        label: `${monthNames[parseInt(mo, 10) - 1]} '${yr.slice(2)}`,
        books: booksByMonth.find((m) => m.month === month)?.count ?? 0,
        pages: pagesByMonth.find((m) => m.month === month)?.pages ?? 0,
      };
    });
  }

  const selectedYear = typeof year === "number" ? year : currentYear;
  return Array.from({ length: 12 }, (_, i) => {
    const monthKey = `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
    return {
      label: monthNames[i],
      books: booksByMonth.find((m) => m.month === monthKey)?.count ?? 0,
      pages: pagesByMonth.find((m) => m.month === monthKey)?.pages ?? 0,
    };
  });
}
