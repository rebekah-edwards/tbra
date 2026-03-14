"use client";

import { useState, useTransition, useCallback, useRef, useId } from "react";
import { useRouter } from "next/navigation";
import { setBookRating } from "@/lib/actions/rating";

interface StarRatingProps {
  bookId: string;
  userRating: number | null;
  aggregate: { average: number; count: number } | null;
  isLoggedIn: boolean;
}

function Star({
  fill,
  size = 24,
  interactive = false,
  onSelect,
  starIndex,
}: {
  fill: number; // 0 to 1
  size?: number;
  interactive?: boolean;
  onSelect?: (rating: number) => void;
  starIndex: number; // 0-based
}) {
  const ref = useRef<SVGSVGElement>(null);
  const clipId = useId();

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!interactive || !onSelect || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const fraction = x / rect.width;
      // Snap to nearest quarter: 0.25, 0.50, 0.75, 1.0
      const quarter = Math.ceil(fraction * 4) / 4;
      const rating = starIndex + quarter;
      onSelect(Math.min(5, Math.max(0.25, rating)));
    },
    [interactive, onSelect, starIndex]
  );

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      onClick={handleClick}
      className={interactive ? "cursor-pointer" : ""}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      {/* Empty star outline */}
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-muted/40"
      />
      {/* Filled portion */}
      {fill > 0 && (
        <path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
          fill="currentColor"
          clipPath={`url(#${clipId})`}
          className="text-yellow-400"
        />
      )}
    </svg>
  );
}

function StarRow({
  rating,
  size = 24,
  interactive = false,
  onSelect,
}: {
  rating: number;
  size?: number;
  interactive?: boolean;
  onSelect?: (rating: number) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => {
        const starFill = Math.min(1, Math.max(0, rating - i));
        return (
          <Star
            key={i}
            fill={starFill}
            size={size}
            interactive={interactive}
            onSelect={onSelect}
            starIndex={i}
          />
        );
      })}
    </div>
  );
}

export function StarRating({
  bookId,
  userRating,
  aggregate,
  isLoggedIn,
}: StarRatingProps) {
  const [localRating, setLocalRating] = useState<number | null>(userRating);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSelect = useCallback(
    (rating: number) => {
      if (!isLoggedIn) {
        router.push("/login");
        return;
      }

      // Toggle off if clicking same rating
      const newRating = localRating === rating ? null : rating;
      setLocalRating(newRating);

      startTransition(async () => {
        await setBookRating(bookId, newRating);
      });
    },
    [bookId, isLoggedIn, localRating, router]
  );

  const displayRating = hoverRating ?? localRating ?? 0;

  return (
    <div className="mt-6 flex flex-col items-center gap-1">
      {/* User's interactive rating */}
      <div
        className={`flex items-center gap-2 ${isPending ? "opacity-60" : ""}`}
        onMouseLeave={() => setHoverRating(null)}
      >
        <InteractiveStarRow
          rating={displayRating}
          onSelect={handleSelect}
          onHover={setHoverRating}
          isLoggedIn={isLoggedIn}
        />
        {localRating ? (
          <span className="text-sm font-medium text-foreground">
            {localRating.toFixed(localRating % 1 === 0 ? 0 : localRating % 0.5 === 0 ? 1 : 2)}
          </span>
        ) : (
          <span className="text-sm text-muted">
            {isLoggedIn ? "Rate this book" : "Log in to rate"}
          </span>
        )}
      </div>

      {/* Aggregate */}
      {aggregate && (
        <p className="text-xs text-muted">
          {aggregate.average.toFixed(1)} avg · {aggregate.count}{" "}
          {aggregate.count === 1 ? "rating" : "ratings"}
        </p>
      )}
    </div>
  );
}

function InteractiveStarRow({
  rating,
  onSelect,
  onHover,
  isLoggedIn,
}: {
  rating: number;
  onSelect: (rating: number) => void;
  onHover: (rating: number | null) => void;
  isLoggedIn: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isLoggedIn || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const starWidth = rect.width / 5;
      const starIndex = Math.floor(x / starWidth);
      const fraction = (x - starIndex * starWidth) / starWidth;
      const quarter = Math.ceil(fraction * 4) / 4;
      const hoverVal = Math.min(5, Math.max(0.25, starIndex + quarter));
      onHover(hoverVal);
    },
    [isLoggedIn, onHover]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isLoggedIn || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const starWidth = rect.width / 5;
      const starIndex = Math.floor(x / starWidth);
      const fraction = (x - starIndex * starWidth) / starWidth;
      const quarter = Math.ceil(fraction * 4) / 4;
      const clickVal = Math.min(5, Math.max(0.25, starIndex + quarter));
      onSelect(clickVal);
    },
    [isLoggedIn, onSelect]
  );

  return (
    <div
      ref={containerRef}
      className={`flex gap-0.5 ${isLoggedIn ? "cursor-pointer" : ""}`}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const starFill = Math.min(1, Math.max(0, rating - i));
        return (
          <Star key={i} fill={starFill} size={28} starIndex={i} />
        );
      })}
    </div>
  );
}
