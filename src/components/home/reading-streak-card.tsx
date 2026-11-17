import { useId } from "react";

interface ReadingStreakCardProps {
  streak: {
    currentStreak: number;
    longestStreak: number;
    unit: "days";
    /** Logged something today (reader's timezone). Optional so a cached
     *  payload from before the field existed still renders. */
    activeToday?: boolean;
  };
}

const FLAME_PATH =
  "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z";

/**
 * Design refresh 2026-11 — mirrors native-ios HomeView ReadingStreakCardView.
 * The flame is the hero: lit orange→rose while the streak is alive, an
 * outline while today is still open, grey at zero. A header pill states
 * today's status outright, and a bar races the reader's own best.
 */
export function ReadingStreakCard({ streak, wide = false }: ReadingStreakCardProps & {
  /** Stats page: fills its column and shows the best run beside the count. */
  wide?: boolean;
}) {
  const alive = streak.currentStreak > 0;
  const doneToday = streak.activeToday;
  const pendingToday = alive && doneToday === false;
  const best = Math.max(streak.longestStreak, streak.currentStreak, 1);
  // The home page renders this card twice (a desktop row and a mobile row,
  // one of them display:none). An SVG gradient inside a display:none tree
  // does not paint, and a shared id resolves to the FIRST one in the
  // document — so a fixed id left the visible flame blank. One id per
  // instance fixes it.
  const flameId = `streak-flame-${useId().replace(/:/g, "")}`;
  const gap = streak.longestStreak - streak.currentStreak;

  const footer = !alive
    ? "Log anything today to light it"
    : pendingToday
      ? "Log anything today to keep it"
      : gap <= 0
        ? "Your best streak yet"
        : `${gap} ${gap === 1 ? "day" : "days"} to beat your best`;

  return (
    <div
      className={`relative overflow-hidden rounded-[18px] border bg-surface flex flex-col ${
        wide ? "h-full w-full gap-3.5 p-5" : "flex-1 min-w-0 lg:flex-none lg:w-[300px] gap-2.5 p-3.5 lg:px-6"
      } ${alive ? "border-orange-400/30" : "border-neon-purple/30"}`}
    >
      {/* One soft colour bloom in the top-right corner */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(150px circle at 100% 0%, ${
            alive ? "rgba(251,146,60,0.30)" : "rgba(192,132,252,0.26)"
          }, transparent)`,
        }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold tracking-wider text-muted">STREAK</p>
        {doneToday === undefined ? (
          alive && streak.longestStreak > 0 ? (
            <span className="text-[11px] font-semibold text-muted">Best {streak.longestStreak}</span>
          ) : null
        ) : doneToday ? (
          <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-accent/20 px-2 text-[11px] font-bold text-accent whitespace-nowrap">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.7-5.4 6a1 1 0 0 1-1.46.03l-2.5-2.6a1 1 0 1 1 1.44-1.38l1.76 1.82 4.68-5.2a1 1 0 0 1 1.48 1.34Z" />
            </svg>
            Today
          </span>
        ) : (
          <span className="streak-pending-pill inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11px] font-bold whitespace-nowrap" title="Nothing logged yet today">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="3.5 3.5" aria-hidden>
              <circle cx="12" cy="12" r="9" />
            </svg>
            {/* Short on purpose: "Not yet today" overflowed a phone-width
                card. The footer line carries the full sentence. */}
            Not yet
          </span>
        )}
      </div>

      <div className="relative flex items-center gap-2.5">
        <svg
          width="50"
          height="50"
          viewBox="0 0 24 24"
          aria-hidden
          // Pulses for as long as the streak is alive — most of all while
          // today is still open, when it is the nudge (Rebekah, 2026-11-16).
          // The glow is what arrives once today counts.
          className={`flex-shrink-0 ${alive ? "streak-breathe" : ""} ${alive && !pendingToday ? "drop-shadow-[0_0_10px_rgba(251,146,60,0.55)]" : ""}`}
        >
          <defs>
            <linearGradient id={flameId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb923c" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>
          </defs>
          <path
            d={FLAME_PATH}
            fill={!alive ? "currentColor" : `url(#${flameId})`}
            className={!alive ? "text-foreground/20" : ""}
          />
        </svg>
        <div>
          <p className="font-heading text-[34px] font-extrabold leading-none tabular-nums">{streak.currentStreak}</p>
          <p className="mt-1 text-[11px] text-muted whitespace-nowrap">{streak.currentStreak === 1 ? "day in a row" : "days in a row"}</p>
        </div>
        {/* The best run beside the count: always on the Stats card, and on the
            Home tile wherever it is wide enough (desktop, 300px). The phone
            tile is half the screen and has no room for it. */}
        {streak.longestStreak > 0 && (
          <div className={`ml-auto text-right ${wide ? "" : "hidden lg:block"}`}>
            <p className="font-heading text-[26px] font-bold leading-none tabular-nums text-foreground/85">{streak.longestStreak}</p>
            <p className="mt-1 text-[11px] text-muted whitespace-nowrap">{streak.longestStreak === 1 ? "day · best" : "days · best"}</p>
          </div>
        )}
      </div>

      <div className="relative mt-auto space-y-1.5">
        <div className="h-[5px] overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full"
            style={{
              width: alive ? `${Math.max(6, (streak.currentStreak / best) * 100)}%` : 0,
              background: "linear-gradient(90deg, #fb923c, #f43f5e)",
            }}
          />
        </div>
        <p className="text-[11px] font-semibold leading-tight text-foreground/75">{footer}</p>
      </div>
    </div>
  );
}
