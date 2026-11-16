"use client";

import { useState } from "react";
import Link from "next/link";

// Same pill as the other genre tags in the book header.
const PILL =
  "rounded-full book-header-pill px-2.5 py-0.5 text-xs font-medium hover:brightness-125 transition-all";

/**
 * Spoiler-sensitive genre tags (lib/spoiler-genres.ts) for the book header's
 * genre row. Hidden by default behind one small pill; tapping it swaps the
 * pill for the real tags. Like "Reveal Content Details" in ContentProfile,
 * the reveal is one-way and lasts only for this page view — nothing is
 * remembered, so the next visit starts hidden again.
 *
 * This is the ONLY place a spoiler-sensitive tag (or a link to its browse
 * page) may be rendered.
 */
export function SpoilerGenrePills({ genres }: { genres: string[] }) {
  const [revealed, setRevealed] = useState(false);

  if (genres.length === 0) return null;

  if (!revealed) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(true)}
        aria-expanded={false}
        title="This tag may give away part of the story"
        className={`${PILL} inline-flex items-center gap-1 border border-dashed border-current/40 cursor-pointer`}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-70"
          aria-hidden="true"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        {genres.length === 1 ? "Spoiler tag" : `${genres.length} spoiler tags`} — tap to reveal
      </button>
    );
  }

  return (
    <>
      {genres.map((genre) => (
        <Link
          key={genre}
          href={`/browse?genre=${encodeURIComponent(genre)}`}
          className={PILL}
        >
          {genre}
        </Link>
      ))}
    </>
  );
}
