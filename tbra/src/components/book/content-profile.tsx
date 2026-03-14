"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

interface Rating {
  categoryKey: string;
  categoryName: string;
  intensity: number;
  notes: string | null;
  evidenceLevel: string;
}

interface ContentProfileProps {
  ratings: Rating[];
}

// Display order for categories
const CATEGORY_ORDER = [
  "sexual_content",
  "violence_gore",
  "profanity_language",
  "substance_use",
  "lgbtqia_representation",
  "religious_content",
  "witchcraft_occult",
  "political_ideological",
  "self_harm_suicide",
  "sexual_assault_coercion",
  "abuse_suffering",
  "user_added",
];

// Short display names for mobile-friendly single-line rendering
const SHORT_NAMES: Record<string, string> = {
  "lgbtqia_representation": "LGBTQ+ Rep.",
  "profanity_language": "Profanity",
  "political_ideological": "Political content",
  "sexual_assault_coercion": "Sexual assault",
  "abuse_suffering": "Abuse & suffering",
};

const intensityColors = [
  "bg-intensity-0",
  "bg-intensity-1",
  "bg-intensity-2",
  "bg-intensity-3",
  "bg-intensity-4",
];

const evidenceBadge: Record<string, { label: string; className: string }> = {
  ai_inferred: {
    label: "AI",
    className: "bg-surface-alt text-muted",
  },
  cited: {
    label: "AI",
    className: "bg-surface-alt text-muted",
  },
  human_verified: {
    label: "Verified",
    className: "bg-primary/10 text-primary-dark",
  },
};

function ExpandableNote({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      // Check if text overflows 5 lines
      setClamped(el.scrollHeight > el.clientHeight);
    }
  }, [text]);

  return (
    <div className="mt-1">
      <p
        ref={textRef}
        className={`text-xs text-muted ${!expanded ? "line-clamp-5" : ""}`}
      >
        {text}
      </p>
      {clamped && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary hover:text-primary-dark"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function RatingCard({ rating }: { rating: Rating }) {
  const badge = evidenceBadge[rating.evidenceLevel];
  const isVerified = rating.evidenceLevel === "human_verified";
  const displayName = SHORT_NAMES[rating.categoryKey] ?? rating.categoryName;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{displayName}</span>
        {badge && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
        )}
      </div>
      <div className="mt-1 flex gap-0.5">
        {[0, 1, 2, 3].map((segment) => (
          <div
            key={segment}
            className={`h-1.5 flex-1 rounded-full ${
              segment < rating.intensity
                ? intensityColors[rating.intensity]
                : "bg-surface-alt"
            }`}
          />
        ))}
      </div>
      {rating.notes && (
        isVerified ? (
          <ExpandableNote text={rating.notes} />
        ) : (
          <p className="mt-1 text-xs text-muted">{rating.notes}</p>
        )
      )}
    </div>
  );
}

export function ContentProfile({ ratings }: ContentProfileProps) {
  const [revealed, setRevealed] = useState(false);

  if (ratings.length === 0) {
    return (
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold uppercase tracking-wide text-neon-blue">What&apos;s Inside</h2>
          <Link href="/methodology" className="rounded-full border border-neon-blue/30 bg-neon-blue/10 px-3 py-1 text-xs font-medium text-neon-blue hover:bg-neon-blue/20 transition-colors">
            How we rate
          </Link>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">No content details yet.</p>
          <p className="mt-2 text-xs text-muted">
            Information will be populated soon.
          </p>
        </div>
      </section>
    );
  }

  // Sort ratings by display order
  const sortedRatings = [...ratings].sort((a, b) => {
    const aIdx = CATEGORY_ORDER.indexOf(a.categoryKey);
    const bIdx = CATEGORY_ORDER.indexOf(b.categoryKey);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold uppercase tracking-wide text-neon-blue">What&apos;s Inside</h2>
        <Link href="/methodology" className="rounded-full border border-neon-blue/30 bg-neon-blue/10 px-3 py-1 text-xs font-medium text-neon-blue hover:bg-neon-blue/20 transition-colors">
          How we rate
        </Link>
      </div>

      <div className="relative mt-4">
        {/* Blurred overlay when not revealed */}
        {!revealed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg">
            <button
              onClick={() => setRevealed(true)}
              className="lime-glow-box rounded-full border border-primary bg-primary/10 px-6 py-3 text-sm font-semibold text-primary shadow-[0_0_20px_rgba(163,230,53,0.25)] transition-all hover:bg-primary/20 hover:shadow-[0_0_30px_rgba(163,230,53,0.4)]"
            >
              Reveal Content Details
            </button>
            <p className="mt-2 text-xs text-muted">will contain mild spoilers</p>
          </div>
        )}

        {/* Ratings grid — blurred when not revealed */}
        <div
          className={`grid grid-cols-2 gap-x-6 gap-y-3 ${!revealed ? "blur-md select-none pointer-events-none" : ""} transition-[filter] duration-300`}
        >
          {sortedRatings.map((rating) => (
            <RatingCard key={rating.categoryKey} rating={rating} />
          ))}
        </div>
      </div>
    </section>
  );
}
