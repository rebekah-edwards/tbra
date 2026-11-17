"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setReadingGoal } from "@/lib/actions/reading-goals";

interface ReadingGoalCardProps {
  goal: { targetBooks: number; completedBooks: number; percentComplete: number } | null;
  year: number;
}

export function ReadingGoalCard({ goal, year }: ReadingGoalCardProps) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(goal?.targetBooks?.toString() ?? "24");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  // Unique per instance: the page renders this card twice (desktop + mobile,
  // one hidden), and a gradient in the display:none copy would not paint.
  const ringId = `goal-ring-${useId().replace(/:/g, "")}`;

  // How far through the goal's year today is (0…1), drawn as a tick across
  // the ring so the arc reads against it: past the tick is ahead of pace,
  // short of it is behind. Mirrors native-ios GoalSweepRing.yearElapsed — the
  // web ring shipped without it. Read after mount, not during render: the
  // server's "today" (UTC) and the reader's can differ by a day.
  const [yearElapsed, setYearElapsed] = useState<number | null>(null);
  useEffect(() => {
    const now = new Date();
    if (year !== now.getFullYear()) return setYearElapsed(null);
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    setYearElapsed(Math.min(1, Math.max(0, (now.getTime() - start) / (end - start))));
  }, [year]);

  function handleSubmit() {
    const formData = new FormData();
    formData.set("targetBooks", target);
    startTransition(async () => {
      const result = await setReadingGoal(formData);
      if (result.success) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (editing || !goal) {
    return (
      <div className="flex-1 min-w-0 lg:flex-none lg:w-[300px] rounded-[18px] border border-accent/30 bg-surface p-3.5 lg:px-6">
        <p className="text-xs font-medium text-muted mb-2">
          {goal ? `${year} Reading Goal` : `Set a ${year} reading goal`}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max="500"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-20 rounded-lg border border-border bg-surface-alt px-3 py-2 text-center text-lg font-bold"
          />
          <span className="text-sm text-muted">books</span>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save"}
          </button>
          {goal && (
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // Design refresh 2026-11 — mirrors native-ios HomeView ReadingGoalCardView:
  // the ring is the hero (lime→blue sweep), the count is large, and a pill
  // says how the year is pacing.
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, goal.percentComplete));
  const dashOffset = circumference - (Math.max(pct, 2) / 100) * circumference;
  const pace = paceLine(goal, year);

  return (
    <div className="relative flex-1 min-w-0 lg:flex-none lg:w-[300px] overflow-hidden rounded-[18px] border border-accent/30 bg-surface p-3.5 lg:px-6 flex flex-col gap-2.5 hover:border-accent/50 transition-colors">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(150px circle at 100% 0%, rgba(163,230,53,0.30), transparent)" }}
      />
      {/* Edit icon button */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
        title="Edit goal"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      </button>

      {/* Tappable card body → links to completed books */}
      <Link
        href={`/library?tab=activity&filter=completed&year=${year}`}
        className="relative flex flex-1 flex-col gap-2.5"
      >
        <p className="text-[11px] font-bold tracking-wider text-muted">{year} GOAL</p>
        {/* Ring, count and pace pill sit CENTRED in the tile, like the iOS
            tile: left-aligned they hugged the edge and left a ragged gap on
            the right, most of all in the 300px desktop tile. */}
        <div className="flex items-center justify-center gap-2.5">
          <div className="relative h-[58px] w-[58px] flex-shrink-0">
            <svg className="h-[58px] w-[58px] -rotate-90 drop-shadow-[0_0_6px_rgba(163,230,53,0.45)]" viewBox="0 0 80 80">
              <defs>
                <linearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#a3e635" />
                  <stop offset="100%" stopColor="#38bdf8" />
                </linearGradient>
              </defs>
              <circle cx="40" cy="40" r={radius} fill="none" stroke="currentColor" strokeWidth="9" className="text-foreground/10" />
              <circle
                cx="40"
                cy="40"
                r={radius}
                fill="none"
                stroke={`url(#${ringId})`}
                strokeWidth="9"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                className="transition-all duration-700"
              />
            </svg>
            {yearElapsed !== null && (
              <GoalRingTick elapsed={yearElapsed} viewBox={80} radius={radius} strokeWidth={9} />
            )}
            <span className="absolute inset-0 flex items-center justify-center font-heading text-[13px] font-bold tabular-nums">
              {goal.percentComplete}%
            </span>
          </div>
          <div>
            <p className="font-heading text-[34px] font-extrabold leading-none tabular-nums">{goal.completedBooks}</p>
            <p className="mt-1 text-[11px] text-muted whitespace-nowrap">of {goal.targetBooks} books</p>
          </div>
        </div>
        <PacePill pace={pace} className="mt-auto self-center" />
      </Link>
    </div>
  );
}

/**
 * The status pill that sits with the ring ("3 ahead of pace", "18 to go") —
 * iOS GoalPacePill. A bolt when the reader is on or ahead of pace, a
 * chequered flag when there are books still to go.
 */
export function PacePill({ pace, className = "" }: { pace: { text: string; good: boolean }; className?: string }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
        pace.good ? "bg-accent/15 text-accent" : "bg-foreground/10 text-foreground/75"
      } ${className}`}
    >
      {pace.good ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M13.2 2 4.5 13.4a.6.6 0 0 0 .48.96H10l-1.1 7.2a.4.4 0 0 0 .72.3L18.5 10.6a.6.6 0 0 0-.48-.96H13l1-7.3a.4.4 0 0 0-.8-.34Z" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 21V4" />
          <path d="M5 4h14v10H5" />
          <path d="M9.67 4v10M14.33 4v10M5 9h14" strokeWidth="1.4" />
          <path d="M5 4h4.67v5H5zM14.33 4H19v5h-4.67zM9.67 9h4.66v5H9.67z" fill="currentColor" stroke="none" />
        </svg>
      )}
      {pace.text}
    </span>
  );
}

/**
 * The "where today falls in the year" tick across a goal ring (iOS
 * GoalSweepRing.yearElapsed): the arc past the tick is ahead of pace, short
 * of it is behind. Lay it over the ring inside the same `relative` box and
 * give it the ring's own viewBox size, radius and stroke width.
 *
 * It is its own svg so the ring's lime glow does not tint the tick, and it
 * takes the same -90° turn as the ring: angle 0 is 12 o'clock, clockwise.
 */
export function GoalRingTick({
  elapsed,
  viewBox,
  radius,
  strokeWidth,
}: {
  /** 0…1 through the goal's year. */
  elapsed: number;
  viewBox: number;
  radius: number;
  strokeWidth: number;
}) {
  const centre = viewBox / 2;
  const angle = 2 * Math.PI * Math.min(1, Math.max(0, elapsed));
  const reach = strokeWidth / 2 + 4;
  const at = (r: number) => ({ x: centre + r * Math.cos(angle), y: centre + r * Math.sin(angle) });
  const inner = at(radius - reach);
  const outer = at(radius + reach);
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full -rotate-90 overflow-visible"
      viewBox={`0 0 ${viewBox} ${viewBox}`}
    >
      {/* Dark under-stroke so the tick holds on both the lit arc and the track. */}
      <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="rgba(0,0,0,0.45)" strokeWidth={6} strokeLinecap="round" />
      <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" className="text-foreground" />
    </svg>
  );
}

/** Same wording as the iOS tile (ReadingGoal.paceLine in Models.swift). */
export function paceLine(
  goal: { targetBooks: number; completedBooks: number },
  year: number
): { text: string; good: boolean } {
  const left = goal.targetBooks - goal.completedBooks;
  if (left <= 0) return { text: "Goal smashed", good: true };
  const now = new Date();
  if (now.getFullYear() !== year) return { text: `${left} short of the goal`, good: false };
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const days = Math.round((end - start) / 86_400_000);
  const day = Math.floor((now.getTime() - start) / 86_400_000) + 1;
  const delta = goal.completedBooks - Math.floor((goal.targetBooks * day) / days);
  if (delta > 0) return { text: `${delta} ahead of pace`, good: true };
  if (delta === 0) return { text: "Right on pace", good: true };
  return { text: `${left} to go`, good: false };
}
