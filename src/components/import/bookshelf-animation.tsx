"use client";

import { useMemo, useEffect, useState } from "react";

interface BookshelfAnimationProps {
  current: number;
  total: number;
  title: string;
  startTime: number;
  onCancel: () => void;
}

const SPINE_COLORS = [
  "bg-accent/60",
  "bg-neon-blue/50",
  "bg-neon-purple/50",
  "bg-amber-700/50",
  "bg-rose-800/50",
  "bg-slate-500/50",
  "bg-emerald-700/50",
  "bg-sky-800/50",
];

const SHELF_COUNT = 3;
const SPINE_WIDTH_MIN = 10;
const SPINE_WIDTH_MAX = 18;
const SPINE_HEIGHT_MIN = 55;
const SPINE_HEIGHT_MAX = 80;

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

interface SpineData {
  width: number;
  height: number;
  colorClass: string;
  index: number;
}

function generateSpine(index: number): SpineData {
  const r1 = seededRandom(index);
  const r2 = seededRandom(index + 1000);
  const r3 = seededRandom(index + 2000);
  return {
    width: SPINE_WIDTH_MIN + Math.floor(r1 * (SPINE_WIDTH_MAX - SPINE_WIDTH_MIN)),
    height: SPINE_HEIGHT_MIN + Math.floor(r2 * (SPINE_HEIGHT_MAX - SPINE_HEIGHT_MIN)),
    colorClass: SPINE_COLORS[Math.floor(r3 * SPINE_COLORS.length)],
    index,
  };
}

function formatTimeRemaining(totalSeconds: number): string {
  if (totalSeconds <= 0) return "almost done";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function BookshelfAnimation({
  current,
  total,
  title,
  startTime,
  onCancel,
}: BookshelfAnimationProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const [containerWidth, setContainerWidth] = useState(360);

  useEffect(() => {
    setContainerWidth(window.innerWidth);
    const handleResize = () => setContainerWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Lock body scroll while bookshelf is visible
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Calculate how many spines fit per shelf
  const avgWidth = (SPINE_WIDTH_MIN + SPINE_WIDTH_MAX) / 2 + 2;
  const booksPerShelf = Math.max(1, Math.floor((containerWidth - 48) / avgWidth));
  const totalCapacity = booksPerShelf * SHELF_COUNT;

  // Sync book fill to match import percentage (not raw count)
  const filledSlots = Math.round((pct / 100) * totalCapacity);

  // Generate spine data — number of visible spines matches the progress %
  const spines = useMemo(() => {
    const count = Math.min(filledSlots, totalCapacity);
    return Array.from({ length: count }, (_, i) => generateSpine(i));
  }, [filledSlots, totalCapacity]);

  // Assign spines to shelves (bottom to top)
  const shelves = useMemo(() => {
    const result: SpineData[][] = Array.from({ length: SHELF_COUNT }, () => []);
    spines.forEach((spine, i) => {
      const shelfIdx = Math.floor(i / booksPerShelf);
      if (shelfIdx < SHELF_COUNT) {
        result[shelfIdx].push(spine);
      }
    });
    return result;
  }, [spines, booksPerShelf]);

  // Time remaining
  const elapsed = (Date.now() - startTime) / 1000;
  const perBook = current > 0 ? elapsed / current : 0;
  const remaining = Math.ceil(perBook * (total - current));

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top progress bar */}
      <div className="h-1 bg-surface-alt shrink-0">
        <div
          className="h-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Status info — above the shelves in the white/black space */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 min-h-0">
        {/* Pulsing dot + "Importing" label */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <p
            className="text-xs uppercase tracking-widest text-accent font-semibold font-heading"
           
          >
            Importing your library
          </p>
        </div>

        {/* Big counter */}
        <p
          className="text-4xl sm:text-5xl font-bold font-heading text-foreground tabular-nums"

        >
          {current}
          <span className="text-muted text-xl sm:text-2xl font-normal"> / {total}</span>
        </p>

        {/* Percentage bar */}
        <div className="w-64 max-w-full mt-3">
          <div className="h-2 bg-surface-alt rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted text-center mt-1.5 tabular-nums">{pct}%</p>
        </div>

        {/* Current book title */}
        {title && (
          <p className="text-xs text-muted mt-3 truncate max-w-[80%] text-center italic">
            {title}
          </p>
        )}

        {/* Time remaining */}
        {current > 0 && (
          <p className="text-xs text-muted mt-1.5">
            ~{formatTimeRemaining(remaining)} remaining
          </p>
        )}

        {/* "Please don't leave" callout */}
        <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-1.5">
          <p className="text-[11px] text-foreground font-medium text-center">
            ⚠ Please don&apos;t leave this page while importing
          </p>
        </div>

        {/* Cancel button — in the status area so it's always visible */}
        <button
          onClick={onCancel}
          className="mt-3 px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-md transition-colors"
        >
          Cancel Import
        </button>
      </div>

      {/* Bookshelf area — bottom portion, padded above the mobile nav bar */}
      <div className="shrink-0">
        {/* Shelves — pb-16 clears the bottom nav bar on mobile */}
        <div className="px-4 pb-16 sm:pb-4">
          {shelves.map((shelfSpines, shelfIdx) => (
            <div key={shelfIdx} className="relative">
              <div className="flex items-end gap-[2px] px-2 min-h-[60px] sm:min-h-[80px]">
                {shelfSpines.map((spine) => (
                  <div
                    key={spine.index}
                    className={`${spine.colorClass} rounded-t-sm border-r border-white/10 animate-[slideUp_0.3s_ease-out]`}
                    style={{
                      width: `${spine.width}px`,
                      height: `${spine.height}px`,
                    }}
                  >
                    <div className="h-full flex flex-col justify-center items-center opacity-20">
                      <div className="w-[60%] h-px bg-white/40" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="h-[5px] bg-gradient-to-b from-amber-900/40 to-amber-950/60 shadow-[0_2px_6px_rgba(0,0,0,0.4)]" />
              <div className="h-[2px] bg-amber-900/20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
