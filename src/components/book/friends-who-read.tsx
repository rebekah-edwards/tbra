"use client";

import Link from "next/link";
import type { FriendWhoRead } from "@/lib/queries/follows";

function Avatar({ friend, size = "sm" }: { friend: FriendWhoRead; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-7 w-7 text-[10px]" : "h-8 w-8 text-[11px]";
  return (
    <span
      className={`flex ${dim} items-center justify-center rounded-full font-bold text-black overflow-hidden flex-shrink-0 ring-2 ring-surface`}
      style={{ backgroundColor: friend.avatarUrl ? undefined : "#a3e635" }}
    >
      {friend.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={friend.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        (friend.displayName || "?")[0].toUpperCase()
      )}
    </span>
  );
}

function StackedAvatars({ friends, max = 3 }: { friends: FriendWhoRead[]; max?: number }) {
  const visible = friends.slice(0, max);
  const overflow = friends.length - max;
  return (
    <div className="flex flex-shrink-0">
      {visible.map((friend, i) => (
        <span key={friend.userId} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: max - i }} className="relative">
          <Avatar friend={friend} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          style={{ marginLeft: -8, zIndex: 0 }}
          className="relative flex h-7 w-7 items-center justify-center rounded-full bg-surface-alt text-[10px] font-semibold text-muted ring-2 ring-surface"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function MiniStars({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25;
  const stars: string[] = [];
  for (let i = 0; i < fullStars; i++) stars.push("full");
  if (hasHalf) stars.push("half");
  while (stars.length < 5) stars.push("empty");

  return (
    <span className="inline-flex gap-px">
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

function getName(friend: FriendWhoRead) {
  return friend.displayName || friend.username || "A friend";
}

function getNames(friends: FriendWhoRead[]) {
  if (friends.length === 1) return getName(friends[0]);
  if (friends.length === 2) return `${getName(friends[0])} and ${getName(friends[1])}`;
  return `${friends.length} friends`;
}

interface FriendsWhoReadProps {
  friends: FriendWhoRead[];
  bookId: string;
  bookSlug?: string | null;
}

export function FriendsWhoRead({ friends, bookId, bookSlug }: FriendsWhoReadProps) {
  if (friends.length === 0) return null;

  const withReviews = friends.filter((f) => f.reviewId);
  const reviewerIds = new Set(withReviews.map((f) => f.userId));

  // Completed without a review (reviewers get their own row)
  const completedOnly = friends.filter((f) => f.state === "completed" && !reviewerIds.has(f.userId));
  const reading = friends.filter((f) => f.state === "currently_reading");
  const tbr = friends.filter((f) => f.state === "tbr");
  const withNotes = friends.filter((f) => f.hasNotes && !f.reviewId);

  const completedOnlyAvg = completedOnly.length > 0
    ? completedOnly.reduce((sum, f) => sum + (f.rating ?? 0), 0) / completedOnly.filter((f) => f.rating != null).length
    : null;

  const bookPath = bookSlug ? `/book/${bookSlug}` : `/book/${bookId}`;

  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/50">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );

  const rows: { key: string; avatars: FriendWhoRead[]; text: string; right: React.ReactNode; href?: string }[] = [];

  // Reviews first — these are the richest interactions
  for (const friend of withReviews) {
    rows.push({
      key: `review-${friend.userId}`,
      avatars: [friend],
      text: `${getName(friend)} reviewed this`,
      right: (
        <span className="flex items-center gap-2">
          {friend.rating != null && <MiniStars rating={friend.rating} />}
          {chevron}
        </span>
      ),
      href: `${bookPath}/reviews#review-${friend.reviewId}`,
    });
  }

  // Completed (without review)
  if (completedOnly.length > 0) {
    rows.push({
      key: "completed",
      avatars: completedOnly,
      text: `${getNames(completedOnly)} finished this`,
      right: completedOnlyAvg && !isNaN(completedOnlyAvg) ? <MiniStars rating={completedOnlyAvg} /> : null,
    });
  }

  if (reading.length > 0) {
    rows.push({
      key: "reading",
      avatars: reading,
      text: reading.length === 1 ? `${getName(reading[0])} is reading this` : `${reading.length} friends are reading this`,
      right: <span className="text-[10px] text-accent font-medium">Now</span>,
    });
  }

  if (tbr.length > 0) {
    rows.push({
      key: "tbr",
      avatars: tbr,
      text: tbr.length === 1 ? `${getName(tbr[0])} has this on TBR` : `${tbr.length} friends have this on TBR`,
      right: null,
    });
  }

  for (const friend of withNotes) {
    rows.push({
      key: `notes-${friend.userId}`,
      avatars: [friend],
      text: `${getName(friend)} left reading notes`,
      right: chevron,
      href: `${bookPath}/notes`,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="section-heading text-sm mb-3">Friends&apos; Activity</h2>
      <div className="space-y-1">
        {rows.map((row) => {
          const content = (
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-alt/50">
              <StackedAvatars friends={row.avatars} />
              <span className="flex-1 text-sm text-foreground/80">{row.text}</span>
              {row.right && <span className="flex-shrink-0">{row.right}</span>}
            </div>
          );

          return row.href ? (
            <Link key={row.key} href={row.href} className="block">
              {content}
            </Link>
          ) : (
            <div key={row.key}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
