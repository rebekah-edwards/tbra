"use client";

import { useCallback, useRef, useId } from "react";

const STAR_PATH =
  "M12 1.5c.4 0 .8.2 1 .6l2.5 5.2 5.7.8c.4.06.7.3.9.7.1.3.0.7-.2 1l-4.1 4 1 5.7c.06.4-.1.8-.4 1-.3.2-.7.3-1.1.1L12 18.1l-5.1 2.7c-.4.2-.8.1-1.1-.1-.3-.2-.5-.6-.4-1l1-5.7-4.1-4c-.3-.3-.4-.7-.2-1 .1-.3.5-.6.9-.7l5.7-.8L11 2.1c.2-.4.6-.6 1-.6z";

function LargeStar({ fill, index }: { fill: number; index: number }) {
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
  onRatingChange: (rating: number | null) => void;
  onDnfChange: (dnf: boolean) => void;
  onDnfPercentChange: (percent: number | null) => void;
}

export function StepOverallRating({
  rating,
  didNotFinish,
  dnfPercentComplete,
  onRatingChange,
  onDnfChange,
  onDnfPercentChange,
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

  const displayRating = rating ?? 0;

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
          return <LargeStar key={i} fill={starFill} index={i} />;
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
          <div className="flex items-center gap-3 w-full">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={dnfPercentComplete ?? 0}
              onChange={(e) => onDnfPercentChange(Number(e.target.value) || null)}
              className="flex-1 accent-primary"
            />
            <span className="text-sm font-medium text-foreground w-12 text-right">
              {dnfPercentComplete ?? 0}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
