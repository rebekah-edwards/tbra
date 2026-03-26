"use client";

import { useId } from "react";

// Rounded-point star path — softer edges than the sharp default
const STAR_PATH =
  "M12 1.5c.4 0 .8.2 1 .6l2.5 5.2 5.7.8c.4.06.7.3.9.7.1.3.0.7-.2 1l-4.1 4 1 5.7c.06.4-.1.8-.4 1-.3.2-.7.3-1.1.1L12 18.1l-5.1 2.7c-.4.2-.8.1-1.1-.1-.3-.2-.5-.6-.4-1l1-5.7-4.1-4c-.3-.3-.4-.7-.2-1 .1-.3.5-.6.9-.7l5.7-.8L11 2.1c.2-.4.6-.6 1-.6z";

interface RoundedStarProps {
  fill: number; // 0 to 1
  size?: number;
  className?: string;
}

export function RoundedStar({ fill, size = 24, className }: RoundedStarProps) {
  const clipId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      {/* Empty star outline */}
      <path
        d={STAR_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        className="text-muted/40"
      />
      {/* Filled portion */}
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

export function StarRow({
  rating,
  size = 24,
  className,
}: {
  rating: number;
  size?: number;
  className?: string;
}) {
  return (
    <div className={`flex gap-0.5 ${className ?? ""}`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const starFill = Math.min(1, Math.max(0, rating - i));
        return <RoundedStar key={i} fill={starFill} size={size} />;
      })}
    </div>
  );
}

export { STAR_PATH };
