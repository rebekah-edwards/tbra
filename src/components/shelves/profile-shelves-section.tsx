"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { NoCover } from "@/components/no-cover";
import { PremiumGate } from "@/components/premium-gate";
import type { ShelfSummary } from "@/lib/queries/shelves";
import { toggleFollowShelf } from "@/lib/actions/shelves";

/** Compact follow toggle for a shelf listed on someone's public profile. */
function ProfileShelfFollowButton({
  shelfId,
  initialFollowing,
}: {
  shelfId: string;
  initialFollowing: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const next = !following;
        setFollowing(next); // optimistic
        startTransition(async () => {
          const result = await toggleFollowShelf(shelfId);
          if (!result.success) setFollowing(!next);
          else setFollowing(result.isFollowing);
        });
      }}
      data-active={following ? "true" : undefined}
      className="btn-glass cursor-pointer gap-1 px-2.5 py-0.5 text-[10px] disabled:opacity-60"
    >
      {following ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true" className="text-neon-blue">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
      {following ? "Following" : "Follow"}
    </button>
  );
}

/** Shown before expanding. */
const COLLAPSED_LIMIT = 3;
/** Ceiling after one expansion — beyond this, send them to the full page. */
const EXPANDED_LIMIT = 8;

interface ProfileShelvesSectionProps {
  shelves: ShelfSummary[];
  /** Link base for shelf detail links */
  linkBase: string;
  /** Link for "View all" */
  viewAllHref: string;
  /** Show premium gate if not premium (own profile only) */
  isPremium?: boolean;
  /** Whether this is the user's own profile */
  isOwner?: boolean;
  /** Shelf ids the viewer already follows — enables the inline Follow button
   *  on someone else's public profile. */
  followedShelfIds?: string[];
  /** Viewer is signed in (an anonymous visitor can't follow). */
  canFollow?: boolean;
}

/** A single shelf rendered as a mini horizontal book row — like Top Shelf but shorter */
function MiniShelfRow({
  shelf,
  linkBase,
  showFollow = false,
  initialFollowing = false,
}: {
  shelf: ShelfSummary;
  linkBase: string;
  /** Someone else's public profile — offer to follow the shelf right here
   *  instead of only on the shelf's own page (punch list #5.2). */
  showFollow?: boolean;
  initialFollowing?: boolean;
}) {
  const accentColor = shelf.color || "#d97706";

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: accentColor }}
          />
          <Link
            href={`${linkBase}/${shelf.slug}`}
            className="text-xs font-bold text-foreground hover:text-neon-blue transition-colors"
          >
            {shelf.name}
          </Link>
          <span className="text-[10px] text-muted/50">{shelf.bookCount}</span>
        </div>
        <div className="flex items-center gap-2.5">
          {showFollow && (
            <ProfileShelfFollowButton shelfId={shelf.id} initialFollowing={initialFollowing} />
          )}
          <Link href={`${linkBase}/${shelf.slug}`} className="text-[10px] font-medium read-more-link">
            View →
          </Link>
        </div>
      </div>

      {shelf.coverUrls.length > 0 ? (
        <div className="relative">
          {/* Glass shelf; the reader's shelf colour is carried by the dot,
              a thin ring and the ledge (2026-11 refresh). */}
          <div
            className="relative overflow-hidden rounded-[16px] border bg-surface/60 px-3 pt-3 pb-0 backdrop-blur-md"
            style={{ borderColor: `${accentColor}38` }}
          >
            <div className="flex gap-2 items-end overflow-x-auto pb-2.5 -mx-0.5 px-0.5 pr-8 no-scrollbar mask-fade-right">
              {shelf.coverUrls.map((url, i) => {
                const bookSlug = shelf.coverSlugs?.[i];
                const cover = (
                  <Image
                    src={url}
                    alt=""
                    width={46}
                    height={69}
                    className="h-[69px] w-[46px] rounded-sm object-cover shadow-[2px_2px_6px_rgba(0,0,0,0.3)]"
                  />
                );
                return bookSlug ? (
                  <Link key={i} href={`/book/${bookSlug}`} className="shrink-0 hover:opacity-80 transition-opacity">
                    {cover}
                  </Link>
                ) : (
                  <div key={i} className="shrink-0">
                    {cover}
                  </div>
                );
              })}
            </div>
            {/* Ledge */}
            <div className="h-[3px] -mx-3" style={{ background: `${accentColor}b3` }} />
          </div>
        </div>
      ) : (
        <div
          className="rounded-[16px] border border-dashed bg-surface/40 p-3 text-center"
          style={{ borderColor: `${accentColor}40` }}
        >
          <p className="text-[10px] text-muted/50">Empty shelf</p>
        </div>
      )}
    </section>
  );
}

export function ProfileShelvesSection({
  shelves,
  linkBase,
  viewAllHref,
  isPremium = true,
  isOwner = false,
  followedShelfIds = [],
  canFollow = false,
}: ProfileShelvesSectionProps) {
  const followed = new Set(followedShelfIds);
  const [expanded, setExpanded] = useState(false);
  const visible = shelves.slice(0, expanded ? EXPANDED_LIMIT : COLLAPSED_LIMIT);

  // On own profile, show premium gate if not premium
  if (isOwner && !isPremium) {
    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-heading text-sm">Shelves</h2>
        </div>
        <PremiumGate isPremium={false} featureName="Custom Shelves" />
      </section>
    );
  }

  // Don't show section if no shelves on others' profiles
  if (!isOwner && shelves.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-heading text-sm">Shelves</h2>
        {/* Owners keep a permanent way through to shelf management; visitors
            only get the header link once the inline list can't hold them all. */}
        {shelves.length > 0 && (isOwner || shelves.length > EXPANDED_LIMIT) && (
          <Link href={viewAllHref} className="text-xs font-medium read-more-link">
            View all →
          </Link>
        )}
      </div>

      {shelves.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-foreground/15 bg-surface/40 p-6 text-center">
          <p className="text-sm text-muted">No shelves yet</p>
          <Link
            href="/library/shelves"
            className="mt-2 inline-block text-xs font-medium text-neon-blue hover:text-neon-blue/80"
          >
            Create your first shelf →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((shelf) => (
            <MiniShelfRow
              key={shelf.id}
              shelf={shelf}
              linkBase={linkBase}
              showFollow={!isOwner && canFollow}
              initialFollowing={followed.has(shelf.id)}
            />
          ))}

          {/* Three shown, then one expansion to at most EXPANDED_LIMIT, then
              (and only then) a link out to the full page. */}
          {!expanded && shelves.length > COLLAPSED_LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="block w-full text-center text-xs font-medium text-muted hover:text-foreground transition-colors py-2"
            >
              View {Math.min(shelves.length, EXPANDED_LIMIT) - COLLAPSED_LIMIT} more{" "}
              {Math.min(shelves.length, EXPANDED_LIMIT) - COLLAPSED_LIMIT === 1 ? "shelf" : "shelves"}
            </button>
          )}

          {expanded && (
            <div className="flex items-center justify-center gap-4 py-2">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                Show fewer
              </button>
              {shelves.length > EXPANDED_LIMIT && (
                <Link href={viewAllHref} className="text-xs font-medium read-more-link">
                  View all {shelves.length} shelves →
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
