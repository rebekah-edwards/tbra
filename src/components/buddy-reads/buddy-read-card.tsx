"use client";

import Image from "next/image";
import Link from "next/link";
import { NoCover } from "@/components/no-cover";

interface BuddyReadCardProps {
  id: string;
  slug: string;
  name: string;
  bookTitle: string;
  bookCoverUrl: string | null;
  memberCount: number;
  status: "active" | "completed";
  hostName: string;
  /** The viewer was invited but hasn't joined yet. */
  invited?: boolean;
  myProgress: number | null;
}

// 2026-11 refresh: the card sits on its own blurred cover art like the Reading
// Now and Up Next cards, with a tipped cover, the title in the heading face and
// glass badges whose hue is a dot.
export function BuddyReadCard({
  slug,
  bookTitle,
  bookCoverUrl,
  memberCount,
  status,
  hostName,
  invited = false,
  myProgress,
}: BuddyReadCardProps) {
  return (
    <Link
      href={`/buddy-reads/${slug}`}
      className="group relative block overflow-hidden rounded-[18px] border border-foreground/10 bg-surface tap-scale transition-colors hover:border-foreground/25"
    >
      {bookCoverUrl && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <Image
            src={bookCoverUrl}
            alt=""
            fill
            sizes="(max-width: 672px) 100vw, 672px"
            className="book-card-bg-img scale-150 object-cover"
          />
          <div className="absolute inset-0 currently-reading-overlay" />
        </div>
      )}

      <div className="relative flex items-center gap-4 p-3.5 pl-4">
        <div className="h-[96px] w-[64px] flex-shrink-0 -rotate-3 transition-transform duration-200 group-hover:rotate-0">
          {bookCoverUrl ? (
            <Image
              src={bookCoverUrl}
              alt={`Cover of ${bookTitle}`}
              width={64}
              height={96}
              className="h-full w-full rounded-lg object-cover shadow-[0_8px_18px_rgba(0,0,0,0.45)] ring-1 ring-white/10"
            />
          ) : (
            <NoCover title={bookTitle} className="h-full w-full shadow-lg" size="sm" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-[17px] font-bold leading-tight book-header-text line-clamp-2">
            {bookTitle}
          </h3>
          {hostName && (
            <p className="mt-0.5 text-xs book-header-text-sub line-clamp-1">Hosted by {hostName}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-surface/80 px-2.5 py-1 text-[11px] font-semibold text-foreground backdrop-blur-md">
              <span
                className={`h-[7px] w-[7px] rounded-full ${
                  invited ? "bg-neon-purple" : status === "active" ? "bg-accent" : "bg-neon-blue"
                }`}
                aria-hidden="true"
              />
              {invited ? "Invited" : status === "active" ? "Active" : "Completed"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-foreground/10 bg-surface/80 px-2.5 py-1 text-[11px] font-semibold text-foreground backdrop-blur-md">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {memberCount} {memberCount === 1 ? "reader" : "readers"}
            </span>
          </div>

          {status === "active" && myProgress !== null && (
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.min(100, Math.max(0, myProgress))}%` }}
              />
            </div>
          )}
        </div>

        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 book-header-text-sub" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </Link>
  );
}
