"use client";

import Link from "next/link";
import type { ActivityItem } from "@/lib/queries/activity-feed";
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

function ActionBadge({ type }: { type: ActivityItem["type"] }) {
  const config: Record<ActivityItem["type"], { label: string; color: string }> = {
    completed: { label: "Finished", color: "bg-neon-blue/15 text-neon-blue border-neon-blue/20" },
    review: { label: "Reviewed", color: "bg-neon-purple/15 text-neon-purple border-neon-purple/20" },
    rating: { label: "Rated", color: "bg-accent/15 text-accent border-accent/20" },
    currently_reading: { label: "Reading", color: "bg-accent/15 text-accent border-accent/20" },
    tbr: { label: "TBR'd", color: "bg-neon-blue/15 text-neon-blue border-neon-blue/20" },
    reading_note: { label: "Note", color: "bg-amber-500/15 text-amber-500 border-amber-500/20" },
  };
  const { label, color } = config[type];
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
    <>
      {/* Mobile: vertical stack */}
      <div className="space-y-3 lg:hidden">
        {activity.map((item, i) => (
          <div
            key={`${item.user.id}-${item.book.id}-${i}`}
            className="flex gap-3 rounded-xl border border-border bg-surface p-3"
          >
            <Link href={`/book/${item.book.slug || item.book.id}`} className="flex-shrink-0">
              {item.book.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.book.coverImageUrl}
                  alt={item.book.title}
                  className="h-16 w-11 rounded object-cover"
                />
              ) : (
                <div className="flex h-16 w-11 items-center justify-center rounded bg-surface-alt text-[8px] text-muted">
                  No cover
                </div>
              )}
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs">
                <Link
                  href={item.user.username ? `/u/${item.user.username}` : "#"}
                  className="flex items-center gap-1.5 font-medium text-foreground hover:underline"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-black overflow-hidden flex-shrink-0">
                    {item.user.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (item.user.displayName || "?")[0].toUpperCase()
                    )}
                  </span>
                  <span className="truncate">
                    {item.user.displayName || item.user.username || "Reader"}
                  </span>
                </Link>
                <span className={`text-xs ${
                  item.type === "completed" ? "text-neon-blue" :
                  item.type === "review" ? "text-neon-purple" :
                  item.type === "reading_note" ? "text-amber-500" :
                  "text-accent"
                }`}>
                  {item.type === "completed" ? "finished" :
                   item.type === "review" ? "reviewed" :
                   item.type === "rating" ? "rated" :
                   item.type === "currently_reading" ? "started reading" :
                   item.type === "tbr" ? "added to TBR" :
                   "left a note on"}
                </span>
                <TimeAgo timestamp={item.timestamp} />
              </div>
              <Link
                href={`/book/${item.book.slug || item.book.id}`}
                className="mt-0.5 block text-sm font-semibold text-foreground line-clamp-1 hover:underline"
              >
                {item.book.title}
              </Link>
              {item.rating != null && (
                <div className="mt-1">
                  <StarDisplay rating={item.rating} />
                </div>
              )}
              {item.reviewPreview && (
                <p className="mt-1 text-xs text-muted line-clamp-2 leading-relaxed">
                  {item.reviewPreview}{item.reviewPreview.length >= 100 ? "..." : ""}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: horizontal scrollable stream */}
      <div className="hidden lg:flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 pr-12 no-scrollbar mask-fade-right">
        {activity.map((item, i) => (
          <div
            key={`${item.user.id}-${item.book.id}-${i}`}
            className="w-[260px] flex-shrink-0 rounded-xl border border-border bg-surface overflow-hidden hover:border-border/80 transition-colors"
          >
            {/* Book cover as top banner */}
            <Link href={`/book/${item.book.slug || item.book.id}`} className="block relative h-20 overflow-hidden">
              {item.book.coverImageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.book.coverImageUrl}
                    alt=""
                    aria-hidden
                    className="book-card-bg-img absolute inset-0 h-full w-full scale-150 object-cover"
                  />
                  <div className="absolute inset-0 currently-reading-overlay" />
                  <div className="absolute bottom-2 left-3 z-10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.book.coverImageUrl}
                      alt={item.book.title}
                      className="h-14 w-[38px] rounded object-cover shadow-lg border border-white/10"
                    />
                  </div>
                  <div className="absolute bottom-2 left-14 right-3 z-10">
                    <p className="text-sm font-bold book-header-text line-clamp-2 leading-snug">{item.book.title}</p>
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center bg-surface-alt">
                  <p className="text-sm font-bold text-foreground/60 px-3 line-clamp-2">{item.book.title}</p>
                </div>
              )}
            </Link>

            {/* Card body */}
            <div className="p-3 space-y-2">
              {/* Action badge + rating */}
              <div className="flex items-center gap-2">
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
                <p className="text-xs text-muted line-clamp-2 leading-relaxed italic">
                  &ldquo;{item.reviewPreview}{item.reviewPreview.length >= 100 ? "..." : ""}&rdquo;
                </p>
              )}

              {/* User attribution */}
              <Link
                href={item.user.username ? `/u/${item.user.username}` : "#"}
                className="flex items-center gap-1.5 hover:underline"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-black overflow-hidden flex-shrink-0">
                  {item.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (item.user.displayName || "?")[0].toUpperCase()
                  )}
                </span>
                <span className="text-xs font-medium text-foreground/70 truncate">
                  {item.user.displayName || item.user.username || "Reader"}
                </span>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
