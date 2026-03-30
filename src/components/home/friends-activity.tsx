"use client";

import Link from "next/link";
import Image from "next/image";
import type { ActivityItem } from "@/lib/queries/activity-feed";
import { NoCover } from "@/components/no-cover";
import { formatRating } from "@/lib/text-utils";

function StarDisplay({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25;
  const stars: string[] = [];
  for (let i = 0; i < fullStars; i++) stars.push("full");
  if (hasHalf) stars.push("half");
  while (stars.length < 5) stars.push("empty");

  return (
    <span className="inline-flex gap-0.5">
      {stars.map((type, i) => (
        <svg key={i} viewBox="0 0 20 20" className="h-3 w-3">
          <path
            d="M10 1l2.39 4.84L18 6.71l-4 3.9.94 5.5L10 13.38 5.06 16.1 6 10.6l-4-3.9 5.61-.87z"
            fill={type === "empty" ? "none" : "currentColor"}
            stroke="currentColor"
            strokeWidth="1"
            className={type === "empty" ? "text-muted/30" : "text-accent"}
          />
        </svg>
      ))}
    </span>
  );
}

const ACTION_CONFIG: Record<ActivityItem["type"], { label: string; color: string }> = {
  completed: { label: "Finished", color: "bg-neon-blue/15 text-neon-blue border-neon-blue/20" },
  review: { label: "Reviewed", color: "bg-neon-purple/15 text-neon-purple border-neon-purple/20" },
  rating: { label: "Rated", color: "bg-accent/15 text-accent border-accent/20" },
  currently_reading: { label: "Reading", color: "bg-accent/15 text-accent border-accent/20" },
  tbr: { label: "TBR'd", color: "bg-neon-blue/15 text-neon-blue border-neon-blue/20" },
  reading_note: { label: "Note", color: "bg-amber-500/15 text-amber-500 border-amber-500/20" },
};

function ActionBadge({ type }: { type: ActivityItem["type"] }) {
  const { label, color } = ACTION_CONFIG[type];
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${color}`}>
      {label}
    </span>
  );
}

function TimeAgo({ timestamp }: { timestamp: string }) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  let label: string;
  if (minutes < 1) label = "now";
  else if (minutes < 60) label = `${minutes}m`;
  else if (hours < 24) label = `${hours}h`;
  else if (days < 30) label = `${days}d`;
  else label = new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return <span className="text-[10px] text-muted">{label}</span>;
}

function UserAvatar({ user }: { user: ActivityItem["user"] }) {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-black overflow-hidden flex-shrink-0">
      {user.avatarUrl ? (
        <Image src={user.avatarUrl} alt="" width={20} height={20} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        (user.displayName || "?")[0].toUpperCase()
      )}
    </span>
  );
}

function displayName(user: ActivityItem["user"]) {
  return user.displayName || user.username || "Reader";
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
    <div className="flex gap-3 lg:gap-4 overflow-x-auto pb-2 -mx-2 px-2 pr-12 no-scrollbar mask-fade-right">
      {activity.map((item, i) => (
        <div
          key={`${item.user.id}-${item.book.id}-${i}`}
          className="w-[200px] lg:w-[260px] flex-shrink-0 rounded-xl border border-border bg-surface overflow-hidden hover:border-border/80 transition-colors"
        >
          {/* Book cover as top banner */}
          <Link href={`/book/${item.book.slug || item.book.id}`} className="block relative h-16 lg:h-20 overflow-hidden">
            {item.book.coverImageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.book.coverImageUrl}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="book-card-bg-img absolute inset-0 h-full w-full scale-150 object-cover"
                />
                <div className="absolute inset-0 currently-reading-overlay" />
                <div className="absolute bottom-1.5 lg:bottom-2 left-2 lg:left-3 z-10">
                  <Image
                    src={item.book.coverImageUrl}
                    alt={item.book.title}
                    width={38}
                    height={56}
                    loading="lazy"
                    className="h-11 w-[30px] lg:h-14 lg:w-[38px] rounded object-cover shadow-lg border border-white/10"
                  />
                </div>
                <div className="absolute bottom-1.5 lg:bottom-2 left-10 lg:left-14 right-2 lg:right-3 z-10">
                  <p className="text-xs lg:text-sm font-bold book-header-text line-clamp-2 leading-snug">{item.book.title}</p>
                </div>
              </>
            ) : (
              <NoCover title={item.book.title} className="h-full w-full" size="sm" />
            )}
          </Link>

          {/* Card body */}
          <div className="p-2.5 lg:p-3 space-y-1.5 lg:space-y-2">
            {/* Action badge + rating */}
            <div className="flex items-center gap-1.5 lg:gap-2">
              <ActionBadge type={item.type} />
              {item.rating != null && (
                <span className="text-xs font-medium text-foreground/70">
                  {formatRating(item.rating)} ★
                </span>
              )}
              <TimeAgo timestamp={item.timestamp} />
            </div>

            {/* Review snippet */}
            {item.reviewPreview && (
              <p className="text-[11px] lg:text-xs text-muted line-clamp-2 leading-relaxed italic">
                &ldquo;{item.reviewPreview}{item.reviewPreview.length >= 100 ? "..." : ""}&rdquo;
              </p>
            )}

            {/* User attribution */}
            <Link
              href={item.user.username ? `/u/${item.user.username}` : "#"}
              className="flex items-center gap-1.5 hover:underline"
            >
              <UserAvatar user={item.user} />
              <span className="text-xs font-medium text-foreground/70 truncate">
                {displayName(item.user)}
              </span>
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
