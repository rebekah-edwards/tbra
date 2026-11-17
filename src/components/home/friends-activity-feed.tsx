"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { ActivityItem } from "@/lib/queries/activity-feed";
import { NoCover } from "@/components/no-cover";
import {
  CaptionIcon,
  ReviewCard,
  UserAvatar,
  activityHref,
  describe,
  displayName,
  hasQuote,
  shortAgo,
} from "@/components/home/friends-activity";

// The full friends activity list (/activity): the home rail's two tiers,
// stacked. Written reviews are full-width cards; everything else is a
// one-line row. More loads as the reader nears the bottom.

const PAGE_SIZE = 20;

/** One reader + book appears once in the feed, so that pair is the identity. */
const keyOf = (item: ActivityItem) => `${item.user.id}:${item.book.id}`;

function ActivityRow({ item }: { item: ActivityItem }) {
  const name = displayName(item.user);
  const { glyph, tint, spoken } = describe(item);
  return (
    <Link
      href={activityHref(item)}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 transition-colors hover:border-foreground/25"
    >
      <UserAvatar user={item.user} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-foreground/80 line-clamp-2">
          <span className="font-semibold text-foreground">{name}</span> {spoken}{" "}
          <span className="font-semibold text-foreground">{item.book.title}</span>
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
          <CaptionIcon glyph={glyph} className={tint} />
          <span suppressHydrationWarning>{shortAgo(item.timestamp)}</span>
        </p>
      </div>
      {item.book.coverImageUrl ? (
        <Image
          src={item.book.coverImageUrl}
          alt=""
          width={32}
          height={48}
          loading="lazy"
          className="h-12 w-8 flex-shrink-0 rounded object-cover shadow-md"
        />
      ) : (
        <NoCover title={item.book.title} className="h-12 w-8 flex-shrink-0" size="sm" />
      )}
    </Link>
  );
}

interface FriendsActivityFeedProps {
  initialItems: ActivityItem[];
  initialNextOffset: number | null;
}

export function FriendsActivityFeed({ initialItems, initialNextOffset }: FriendsActivityFeedProps) {
  const [items, setItems] = useState(initialItems);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (busy.current || nextOffset === null) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/friends-activity?offset=${nextOffset}&limit=${PAGE_SIZE}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { items: ActivityItem[]; nextOffset: number | null } = await res.json();
      setItems((prev) => {
        const seen = new Set(prev.map(keyOf));
        return [...prev, ...data.items.filter((item) => !seen.has(keyOf(item)))];
      });
      setNextOffset(data.nextOffset);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [nextOffset]);

  // Load the next page a little before the reader reaches the end. A failed
  // load stops the observer so it cannot retry in a loop; the button retries.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || nextOffset === null || failed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, nextOffset, failed]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-muted">Nothing yet. Follow readers to see what they are reading.</p>
        <Link href="/people" className="mt-3 inline-block text-sm font-semibold text-neon-blue">
          Find readers
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {items.map((item) =>
        hasQuote(item) ? (
          <ReviewCard key={keyOf(item)} item={item} layout="feed" />
        ) : (
          <ActivityRow key={keyOf(item)} item={item} />
        )
      )}

      <div ref={sentinel} aria-hidden className="h-px" />

      {loading && <p className="py-3 text-center text-xs text-muted">Loading more…</p>}
      {failed && (
        <div className="py-3 text-center">
          <p className="text-xs text-muted">Couldn&apos;t load more activity.</p>
          <button type="button" onClick={() => void loadMore()} className="mt-1 text-sm font-semibold text-neon-blue">
            Try again
          </button>
        </div>
      )}
      {nextOffset === null && <p className="py-3 text-center text-xs text-muted">You&apos;re all caught up.</p>}
    </div>
  );
}
