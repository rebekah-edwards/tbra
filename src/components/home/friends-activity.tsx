"use client";

import Link from "next/link";
import Image from "next/image";
import type { ActivityItem } from "@/lib/queries/activity-feed";
import { NoCover } from "@/components/no-cover";
import { formatRating } from "@/lib/text-utils";
import { parseDbDate } from "@/lib/date-utils";

// Two tiers (2026-11 redesign):
//   • a written review is the content — a wide card with the quote
//   • everything else (TBR'd, started, progress, finished, rated) is a small
//     glass tile: who, the cover, one caption line
// Reading notes never appear here; they are private to their author.

function StarDisplay({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25;
  const stars: string[] = [];
  for (let i = 0; i < fullStars; i++) stars.push("full");
  if (hasHalf) stars.push("half");
  while (stars.length < 5) stars.push("empty");

  return (
    <span className="inline-flex gap-0.5" aria-label={`${formatRating(rating)} out of 5`}>
      {stars.map((type, i) => (
        <svg key={i} viewBox="0 0 20 20" className="h-3 w-3" aria-hidden>
          {type === "half" && (
            <defs>
              <clipPath id={`fa-half-${i}`}>
                <rect x="0" y="0" width="10" height="20" />
              </clipPath>
            </defs>
          )}
          <path
            d="M10 1l2.39 4.84L18 6.71l-4 3.9.94 5.5L10 13.38 5.06 16.1 6 10.6l-4-3.9 5.61-.87z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className={type === "empty" ? "text-muted/30" : "text-accent"}
          />
          {type !== "empty" && (
            <path
              d="M10 1l2.39 4.84L18 6.71l-4 3.9.94 5.5L10 13.38 5.06 16.1 6 10.6l-4-3.9 5.61-.87z"
              fill="currentColor"
              clipPath={type === "half" ? `url(#fa-half-${i})` : undefined}
              className="text-accent"
            />
          )}
        </svg>
      ))}
    </span>
  );
}

/** Relative time, short form. Handles ISO, naive-UTC and date-only values. */
function shortAgo(timestamp: string): string {
  const monthDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Finish dates are stored as a calendar day with no time.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(timestamp.trim());
  if (dateOnly) {
    const then = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((today.getTime() - then.getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days < 30) return `${days}d`;
    return monthDay(then);
  }

  const then = parseDbDate(timestamp);
  if (Number.isNaN(then.getTime())) return "";
  const diff = Date.now() - then.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 30) return `${days}d`;
  return monthDay(then);
}

function UserAvatar({ user }: { user: ActivityItem["user"] }) {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-black overflow-hidden flex-shrink-0">
      {user.avatarUrl ? (
        <Image src={user.avatarUrl} alt="" width={20} height={20} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        (user.displayName || user.username || "?")[0].toUpperCase()
      )}
    </span>
  );
}

function displayName(user: ActivityItem["user"]) {
  return user.displayName || user.username || "Reader";
}

/** Blurred-cover backdrop shared by both tiers (same recipe as Up Next). */
function CoverBackdrop({ src, sizes }: { src: string; sizes: string }) {
  return (
    <>
      <Image
        src={src}
        alt=""
        aria-hidden
        fill
        loading="lazy"
        sizes={sizes}
        className="book-card-bg-img scale-150 object-cover"
      />
      <div className="absolute inset-0 currently-reading-overlay" />
    </>
  );
}

// ── Tier 1: a written review ──────────────────────────────────────────────

function ReviewCard({ item, href }: { item: ActivityItem; href: string }) {
  const name = displayName(item.user);
  return (
    <Link
      href={href}
      className="flex w-[236px] lg:w-[288px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-neon-purple/40"
    >
      {/* Banner: the person up top, the book below — mirrors the native app */}
      <div className="relative h-[5.75rem] lg:h-24 flex-shrink-0 overflow-hidden">
        {item.book.coverImageUrl ? (
          <>
            <CoverBackdrop src={item.book.coverImageUrl} sizes="(max-width: 1024px) 236px, 288px" />
            <div className="absolute bottom-1.5 lg:bottom-2 left-2.5 lg:left-3 z-10">
              <Image
                src={item.book.coverImageUrl}
                alt=""
                width={38}
                height={56}
                loading="lazy"
                className="h-11 w-[30px] lg:h-14 lg:w-[38px] rounded object-cover shadow-lg border border-white/10"
              />
            </div>
            <div className="absolute bottom-1.5 lg:bottom-2 left-[3.1rem] lg:left-14 right-2.5 lg:right-3 z-10">
              <p className="text-xs lg:text-sm font-bold book-header-text line-clamp-2 leading-snug">{item.book.title}</p>
            </div>
          </>
        ) : (
          <NoCover title={item.book.title} className="h-full w-full rounded-none" size="sm" />
        )}
        <span className="absolute top-2 left-2.5 right-2.5 lg:left-3 lg:right-3 z-10 flex items-center gap-1.5">
          <UserAvatar user={item.user} />
          <span className="text-xs font-semibold book-header-text truncate">{name}</span>
          <span className="ml-auto flex-shrink-0 text-[10px] book-header-text-muted" suppressHydrationWarning>
            {shortAgo(item.timestamp)}
          </span>
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5 lg:p-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-neon-purple/20 bg-neon-purple/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neon-purple">
            Reviewed
          </span>
          {item.rating != null && item.rating > 0 && <StarDisplay rating={item.rating} />}
        </div>
        <p className="text-xs text-foreground/75 line-clamp-3 leading-relaxed">
          &ldquo;{item.reviewPreview}&rdquo;
        </p>
      </div>
    </Link>
  );
}

// ── Tier 2: everything else ───────────────────────────────────────────────

type Glyph = "bookmark" | "book" | "check" | "star" | "pen";

function CaptionIcon({ glyph, className }: { glyph: Glyph; className: string }) {
  const common = { viewBox: "0 0 20 20", className: `h-3 w-3 flex-shrink-0 ${className}`, "aria-hidden": true } as const;
  switch (glyph) {
    case "bookmark":
      return (
        <svg {...common} fill="currentColor">
          <path d="M5.5 2.5h9A1.5 1.5 0 0 1 16 4v13.2a.5.5 0 0 1-.77.42L10 14.3l-5.23 3.32A.5.5 0 0 1 4 17.2V4a1.5 1.5 0 0 1 1.5-1.5z" />
        </svg>
      );
    case "book":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 5.2C8.6 4.1 6.6 3.6 3.5 3.8v11.4c3.1-.2 5.1.3 6.5 1.4m0-11.4c1.4-1.1 3.4-1.6 6.5-1.4v11.4c-3.1-.2-5.1.3-6.5 1.4m0-11.4v11.4" />
        </svg>
      );
    case "check":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 10.5l4 4 8-9" />
        </svg>
      );
    case "star":
      return (
        <svg {...common} fill="currentColor">
          <path d="M10 1.5l2.5 5.07 5.6.81-4.05 3.95.96 5.57L10 14.27 4.99 16.9l.96-5.57L1.9 7.38l5.6-.81z" />
        </svg>
      );
    case "pen":
      return (
        <svg {...common} fill="currentColor">
          <path d="M14.1 2.6a1.5 1.5 0 0 1 2.1 0l1.2 1.2a1.5 1.5 0 0 1 0 2.1l-9.3 9.3-3.9.9a.5.5 0 0 1-.6-.6l.9-3.9z" />
        </svg>
      );
  }
}

/** The one caption line a tile carries, plus the sentence a screen reader gets. */
function describe(item: ActivityItem): { glyph: Glyph; tint: string; text: string; spoken: string } {
  const stars = item.rating != null && item.rating > 0 ? formatRating(item.rating) : null;
  switch (item.type) {
    case "tbr":
      return { glyph: "bookmark", tint: "text-neon-blue", text: "TBR'd", spoken: "added to TBR" };
    case "currently_reading": {
      if (item.percentComplete != null && item.percentComplete > 0) {
        const pct = Math.round(item.percentComplete);
        return { glyph: "book", tint: "text-accent", text: `${pct}% read`, spoken: `is ${pct}% through` };
      }
      if (item.pageNumber != null && item.pageNumber > 0) {
        return { glyph: "book", tint: "text-accent", text: `p. ${item.pageNumber}`, spoken: `is on page ${item.pageNumber} of` };
      }
      return { glyph: "book", tint: "text-accent", text: "Reading", spoken: "started reading" };
    }
    case "completed":
      return { glyph: "check", tint: "text-neon-blue", text: "Finished", spoken: "finished" };
    case "rating":
      return { glyph: "star", tint: "text-accent", text: stars ?? "Rated", spoken: stars ? `rated ${stars} stars` : "rated" };
    case "review":
      // A review with no text is a rating in practice.
      return stars
        ? { glyph: "star", tint: "text-accent", text: stars, spoken: `rated ${stars} stars` }
        : { glyph: "pen", tint: "text-neon-purple", text: "Reviewed", spoken: "reviewed" };
  }
}

function ActivityTile({ item, href }: { item: ActivityItem; href: string }) {
  const name = displayName(item.user);
  const firstName = name.split(/\s+/)[0];
  const { glyph, tint, text, spoken } = describe(item);
  const cover = item.book.coverImageUrl;

  return (
    <Link
      href={href}
      aria-label={`${name} ${spoken} ${item.book.title}`}
      className="relative flex w-[116px] lg:w-[132px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-foreground/25"
    >
      {cover ? (
        <CoverBackdrop src={cover} sizes="132px" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-surface-alt to-surface" />
      )}

      <div className="relative z-10 flex flex-1 flex-col p-2">
        <div className="flex items-center gap-1.5">
          <UserAvatar user={item.user} />
          <span className="text-[11px] font-semibold book-header-text truncate">{firstName}</span>
        </div>

        <div className="flex flex-1 items-center justify-center py-2">
          {cover ? (
            <Image
              src={cover}
              alt=""
              width={64}
              height={96}
              loading="lazy"
              className="h-[90px] w-[60px] lg:h-[96px] lg:w-[64px] rounded-md object-cover shadow-lg border border-white/10"
            />
          ) : (
            <NoCover title={item.book.title} className="h-[90px] w-[60px] lg:h-[96px] lg:w-[64px] shadow-lg" size="sm" />
          )}
        </div>

        <div className="flex items-center gap-1">
          <CaptionIcon glyph={glyph} className={tint} />
          <span className="text-[11px] font-semibold book-header-text truncate">{text}</span>
          <span className="ml-auto flex-shrink-0 pl-1 text-[10px] book-header-text-muted" suppressHydrationWarning>
            {shortAgo(item.timestamp)}
          </span>
        </div>
      </div>
    </Link>
  );
}

interface FriendsActivityProps {
  activity: ActivityItem[];
}

export function FriendsActivity({ activity }: FriendsActivityProps) {
  if (activity.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-muted">Follow readers to see their activity here</p>
      </div>
    );
  }

  return (
    <div className="flex items-stretch gap-2.5 lg:gap-3 overflow-x-auto pb-2 -mx-2 px-2 pr-12 no-scrollbar mask-fade-right">
      {activity.map((item, i) => {
        const bookPath = `/book/${item.book.slug || item.book.id}`;
        const key = `${item.user.id}-${item.book.id}-${i}`;
        const isWrittenReview = item.type === "review" && !!item.reviewPreview;
        if (isWrittenReview) {
          const href = item.reviewId ? `${bookPath}/reviews#review-${item.reviewId}` : bookPath;
          return <ReviewCard key={key} item={item} href={href} />;
        }
        return <ActivityTile key={key} item={item} href={bookPath} />;
      })}
    </div>
  );
}
