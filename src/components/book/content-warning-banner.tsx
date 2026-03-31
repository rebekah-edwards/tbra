"use client";

import { useState } from "react";

interface ContentConflict {
  categoryName: string;
  bookIntensity: number;
  userMax: number;
}

interface ContentWarningBannerProps {
  conflicts: ContentConflict[];
}

const INTENSITY_LABELS: Record<number, string> = {
  0: "none",
  1: "mild",
  2: "moderate",
  3: "significant",
  4: "extreme",
};

const TOLERANCE_LABELS: Record<number, string> = {
  0: "none",
  1: "mild",
  2: "moderate",
};

export function ContentWarningBanner({ conflicts }: ContentWarningBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (conflicts.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-yellow-500 flex-shrink-0"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" x2="12" y1="9" y2="13" />
          <line x1="12" x2="12.01" y1="17" y2="17" />
        </svg>
        <span className="text-sm font-medium content-flag-text">
          {conflicts.length} content {conflicts.length === 1 ? "flag" : "flags"} for your settings
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`ml-auto text-yellow-500/60 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {conflicts.map((c) => (
            <div
              key={c.categoryName}
              className="flex items-center justify-between text-xs rounded-lg bg-yellow-500/5 px-3 py-2"
            >
              <span className="font-medium text-foreground">{c.categoryName}</span>
              <span className="content-flag-text text-right whitespace-nowrap">
                {INTENSITY_LABELS[c.bookIntensity] ?? "present"} · max {TOLERANCE_LABELS[c.userMax] ?? "limited"}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              requestAnimationFrame(() => {
                const el = document.getElementById("whats-inside");
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              });
            }}
            className="mt-2 text-xs text-link hover:text-link/80 transition-colors"
          >
            See all content details &darr;
          </button>
        </div>
      )}
    </div>
  );
}
