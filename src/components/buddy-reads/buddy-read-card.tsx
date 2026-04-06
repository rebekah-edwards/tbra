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
  myProgress: number | null;
}

export function BuddyReadCard({
  slug,
  name,
  bookTitle,
  bookCoverUrl,
  memberCount,
  status,
  hostName,
  myProgress,
}: BuddyReadCardProps) {
  return (
    <Link
      href={`/buddy-reads/${slug}`}
      className="flex gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-hover tap-scale"
    >
      {/* Book cover thumbnail */}
      <div className="shrink-0 w-[60px] h-[90px]">
        {bookCoverUrl ? (
          <Image
            src={bookCoverUrl}
            alt={`Cover of ${bookTitle}`}
            width={60}
            height={90}
            className="w-full h-full rounded-lg object-cover"
          />
        ) : (
          <NoCover title={bookTitle} className="w-full h-full" size="sm" />
        )}
      </div>

      {/* Details */}
      <div className="flex flex-col justify-center gap-1 min-w-0 flex-1">
        <h3 className="font-heading text-sm font-semibold text-neon-blue leading-tight line-clamp-1">
          {bookTitle}
        </h3>
        <p className="font-body text-[11px] text-muted">
          Hosted by {hostName}
        </p>

        <div className="flex items-center gap-2 mt-0.5">
          {/* Member count */}
          <span className="font-body text-[11px] text-muted/60">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>

          {/* Status badge */}
          {status === "active" ? (
            <span className="inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-semibold text-muted/60">
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
              Completed
            </span>
          )}
        </div>

        {/* Progress bar for active reads where user has progress */}
        {status === "active" && myProgress !== null && (
          <div className="mt-1 w-full">
            <div className="h-1.5 w-full rounded-full bg-border">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.min(100, Math.max(0, myProgress))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
