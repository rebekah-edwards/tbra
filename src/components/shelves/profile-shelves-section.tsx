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
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
        following
          ? "border border-border bg-surface-alt text-muted hover:text-foreground"
          : "bg-accent text-black hover:opacity-90"
      }`}
    >
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
            className="text-xs font-bold text-foreground hover:text-accent transition-colors"
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
          <div
            className="relative rounded-lg border px-3 pt-3 pb-1.5"
            style={{
              background: `linear-gradient(to bottom, ${accentColor}08, ${accentColor}15)`,
              borderColor: `${accentColor}20`,
            }}
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
            {/* Shelf edge */}
            <div
              className="h-[5px] -mx-3 rounded-b-lg shadow-[inset_0_2px_3px_rgba(0,0,0,0.1)]"
              style={{ background: `linear-gradient(to bottom, ${accentColor}30, ${accentColor}45)` }}
            />
          </div>
          {/* Shelf shadow */}
          <div className="h-1.5 mx-1 bg-gradient-to-b from-black/8 to-transparent rounded-b-lg" />
        </div>
      ) : (
        <div
          className="rounded-lg border border-dashed p-3 text-center"
          style={{ borderColor: `${accentColor}25` }}
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
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted">No shelves yet</p>
          <Link
            href="/library/shelves"
            className="mt-2 inline-block text-xs font-medium text-accent hover:text-accent-dark"
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
