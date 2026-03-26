"use client";

import { useCallback, useRef, useId } from "react";

const STAR_PATH =
  "M12 1.5c.4 0 .8.2 1 .6l2.5 5.2 5.7.8c.4.06.7.3.9.7.1.3.0.7-.2 1l-4.1 4 1 5.7c.06.4-.1.8-.4 1-.3.2-.7.3-1.1.1L12 18.1l-5.1 2.7c-.4.2-.8.1-1.1-.1-.3-.2-.5-.6-.4-1l1-5.7-4.1-4c-.3-.3-.4-.7-.2-1 .1-.3.5-.6.9-.7l5.7-.8L11 2.1c.2-.4.6-.6 1-.6z";

function LargeStar({ fill }: { fill: number }) {
  const clipId = useId();

  return (
    <svg width={48} height={48} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      <path
        d={STAR_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        className="text-muted/40"
      />
      {fill > 0 && (
        <path
          d={STAR_PATH}
          fill="currentColor"
          clipPath={`url(#${clipId})`}
          className="text-yellow-400"
        />
      )}
    </svg>
  );
}

interface StepOverallRatingProps {
  rating: number | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  dnfMode: "percent" | "pages";
  bookPages: number | null;
  onRatingChange: (rating: number | null) => void;
  onDnfChange: (dnf: boolean) => void;
  onDnfPercentChange: (percent: number | null) => void;
  onDnfModeChange: (mode: "percent" | "pages") => void;
}

export function StepOverallRating({
  rating,
  didNotFinish,
  dnfPercentComplete,
  dnfMode,
  bookPages,
  onRatingChange,
  onDnfChange,
  onDnfPercentChange,
  onDnfModeChange,
}: StepOverallRatingProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const ratingFromPointer = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const starWidth = rect.width / 5;
      const starIndex = Math.floor(x / starWidth);
      const fraction = (x - starIndex * starWidth) / starWidth;
      const quarter = Math.ceil(fraction * 4) / 4;
      return Math.min(5, Math.max(0.25, starIndex + quarter));
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (didNotFinish) return;
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const val = ratingFromPointer(e.clientX);
      if (val !== null) onRatingChange(val);
    },
    [didNotFinish, ratingFromPointer, onRatingChange]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current || didNotFinish) return;
      const val = ratingFromPointer(e.clientX);
      if (val !== null) onRatingChange(val);
    },
    [didNotFinish, ratingFromPointer, onRatingChange]
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Convert between pages and percent
  const pagesFromPercent = (pct: number | null): number => {
    if (pct === null || !bookPages) return 0;
    return Math.round((pct / 100) * bookPages);
  };

  const percentFromPages = (pages: number): number | null => {
    if (!bookPages || bookPages === 0) return null;
    return Math.round((pages / bookPages) * 100);
  };

  const handleModeSwitch = (mode: "percent" | "pages") => {
    onDnfModeChange(mode);
    // Values stay synced through dnfPercentComplete (always stored as %)
  };

  const handlePagesChange = (pages: number) => {
    const clamped = bookPages ? Math.min(pages, bookPages) : pages;
    const pct = bookPages ? percentFromPages(clamped) : null;
    onDnfPercentChange(pct);
  };

  const handlePercentSliderChange = (pct: number) => {
    onDnfPercentChange(pct || null);
  };

  const handlePagesSliderChange = (pages: number) => {
    const pct = percentFromPages(pages);
    onDnfPercentChange(pct);
  };

  const displayRating = rating ?? 0;
  const currentPages = pagesFromPercent(dnfPercentComplete);

  return (
    <div className="flex flex-col items-center gap-6">
      <h2 className="font-heading text-2xl font-bold text-center">
        What&apos;s your overall rating?
      </h2>

      <div
        ref={containerRef}
        className={`flex gap-1 touch-none select-none ${didNotFinish ? "opacity-30 pointer-events-none" : "cursor-pointer"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const starFill = Math.min(1, Math.max(0, displayRating - i));
          return <LargeStar key={i} fill={starFill} />;
        })}
      </div>

      <div className="text-center">
        {rating ? (
          <span className="text-2xl font-bold text-foreground">
            {rating % 0.25 === 0 && rating % 0.5 !== 0
              ? rating.toFixed(2)
              : rating.toFixed(1)}
          </span>
        ) : (
          <span className="text-sm text-muted">
            {didNotFinish ? "DNF" : "Drag to select"}
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground/70 cursor-pointer">
        <input
          type="checkbox"
          checked={didNotFinish}
          onChange={(e) => {
            onDnfChange(e.target.checked);
            if (e.target.checked) onRatingChange(null);
          }}
          className="w-5 h-5 rounded accent-primary"
        />
        Did Not Finish
      </label>

      {didNotFinish && (
        <div className="flex flex-col items-center gap-3 w-full max-w-xs">
          <p className="text-sm text-muted">How far did you get?</p>

          {/* Mode toggle */}
          <div className="flex rounded-lg bg-surface-alt p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => handleModeSwitch("percent")}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                dnfMode === "percent"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              %
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch("pages")}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                dnfMode === "pages"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Pages
            </button>
          </div>

          {dnfMode === "percent" ? (
            /* Percent mode: slider 0-100 */
            <div className="flex items-center gap-3 w-full">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={dnfPercentComplete ?? 0}
                onChange={(e) => handlePercentSliderChange(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-medium text-foreground w-12 text-right">
                {dnfPercentComplete ?? 0}%
              </span>
            </div>
          ) : bookPages ? (
            /* Pages mode with known page count: slider 0-totalPages */
            <div className="flex items-center gap-3 w-full">
              <input
                type="range"
                min={0}
                max={bookPages}
                step={1}
                value={currentPages}
                onChange={(e) => handlePagesSliderChange(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-medium text-foreground w-24 text-right">
                {currentPages} / {bookPages}
              </span>
            </div>
          ) : (
            /* Pages mode without page count: number input */
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="0"
                value={currentPages || ""}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  // Without bookPages, store raw page count in dnfPercentComplete
                  onDnfPercentChange(val || null);
                }}
                className="w-20 px-3 py-2 text-sm text-center rounded-lg bg-surface-alt border border-border text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-sm text-muted">pages</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
