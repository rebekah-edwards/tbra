"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReadingGoalProgress } from "@/lib/queries/reading-goals";
import type { ReadingStreak } from "@/lib/queries/reading-streak";

interface StatsClientProps {
  year: number | "all";
  currentYear: number;
  goal: ReadingGoalProgress | null;
  streak: ReadingStreak;
  booksByMonth: { month: string; count: number }[];
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
  booksByMonth,
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
  const monthlyData = buildMonthlyData(booksByMonth, pagesByMonth, year, currentYear, monthNames);
  const maxMonthlyBooks = Math.max(...monthlyData.map((m) => m.books), 1);
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
        <HeroCard
          icon="🔥"
          iconBg="bg-orange-500/20"
          value={streak.currentStreak > 0 ? `${streak.currentStreak}` : "—"}
          label={streak.currentStreak === 1 ? "Day streak" : "Day streak"}
        />
        <HeroCard
          icon="⭐"
          iconBg="bg-accent/20"
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

      {/* ─── Row 1: Reading Goal + Monthly Reading ─── */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-4 space-y-6 lg:space-y-0">
        {goal && (
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="section-heading text-xs mb-4">Reading Goal</h2>
            <div className="flex items-center gap-6">
              <div className="relative w-24 h-24 flex-shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-alt)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 42}`}
                    strokeDashoffset={`${2 * Math.PI * 42 * (1 - Math.min(goal.percentComplete, 100) / 100)}`}
                    className="transition-all duration-700" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold font-heading">{goal.percentComplete}%</span>
                </div>
              </div>
              <div>
                <p className="text-2xl font-bold font-heading">
                  {goal.completedBooks} <span className="text-sm font-normal text-muted">of {goal.targetBooks}</span>
                </p>
                <p className="text-xs text-muted mt-0.5">books this year</p>
                {goal.percentComplete >= 100 && <p className="text-xs text-accent font-medium mt-1">🎉 Goal reached!</p>}
              </div>
            </div>
          </section>
        )}
        {monthlyData.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
            <h2 className="section-heading text-xs mb-4">Monthly Reading</h2>
            <div className="-mx-2 overflow-x-auto px-2 pb-1">
              <div
                className="flex items-end gap-1 h-32"
                style={{ minWidth: `${monthlyData.length * 20}px` }}
              >
                {monthlyData.map((m) => {
                  const pct = (m.books / maxMonthlyBooks) * 100;
                  return (
                    <div key={m.label} className="flex-1 min-w-[18px] flex flex-col items-center gap-1 group relative">
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[9px] px-2 py-1 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        {m.books} book{m.books !== 1 ? "s" : ""} · {m.pages.toLocaleString()} pages
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
                      {i === 0 ? "👑" : <span className="text-xs text-muted">{i + 1}</span>}
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
      {booksByMonth.length === 0 && genreBreakdown.length === 0 && ratingDistribution.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface p-12 text-center">
          <span className="text-4xl mb-3 block">📖</span>
          <p className="text-sm font-medium mb-1">No reading data yet</p>
          <p className="text-xs text-muted">Start tracking books to see your stats come alive!</p>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function HeroCard({ icon, iconBg, value, label, href }: { icon: string; iconBg: string; value: string; label: string; href?: string }) {
  const content = (
    <>
      <div className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center mx-auto mb-2`}>
        <span className="text-lg">{icon}</span>
      </div>
      <p className="text-2xl font-bold font-heading">{value}</p>
      <p className="text-[10px] text-muted uppercase tracking-wider mt-0.5">{label}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="rounded-2xl border border-border bg-surface p-4 text-center hover:border-primary/30 transition-colors">
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
