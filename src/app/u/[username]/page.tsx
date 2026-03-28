import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getUserByUsername, getUserStats } from "@/lib/queries/profile";
import { getUserFavorites } from "@/lib/queries/favorites";
import { getUserReviewsWithBooks } from "@/lib/queries/user-reviews";
import { getFollowerCount, getFollowingCount, isFollowing } from "@/lib/queries/follows";
import { getCurrentUser } from "@/lib/auth";
import { getPublicShelves } from "@/lib/queries/shelves";
import { FavoritesShelf } from "@/components/profile/favorites-shelf";
import { ProfileShelvesSection } from "@/components/shelves/profile-shelves-section";
import { PublicReviewHistory } from "@/components/profile/public-review-history";
import { SocialIcons } from "@/components/profile/social-icons";
import { AccountBadge } from "@/components/profile/account-badge";
import { FollowButton } from "@/components/profile/follow-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const user = await getUserByUsername(username);
  if (!user) return { title: "User Not Found | tbr*a" };

  const displayName = user.displayName || user.username || user.email.split("@")[0];

  return {
    title: `Follow ${displayName} on tbr*a | Top Shelf Reads, Reviews & More`,
    description: `Check out ${displayName}'s reading profile on tbr*a. See their top shelf reads, reviews, and what they're reading now.`,
    openGraph: {
      title: `Follow ${displayName} on tbr*a | Top Shelf Reads, Reviews & More`,
      description: `Check out ${displayName}'s reading profile on tbr*a. See their top shelf reads, reviews, and what they're reading now.`,
    },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const user = await getUserByUsername(username);

  if (!user) {
    notFound();
  }

  const session = await getCurrentUser();
  const isOwner = session?.userId === user.id;

  // Privacy gate — non-owners can't see private profiles
  if (user.isPrivate && !isOwner) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface border border-border mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7 text-muted">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h1 className="text-foreground text-lg font-bold mb-1">This profile is private</h1>
        <p className="text-sm text-muted">@{username} has chosen to keep their reading life private.</p>
      </div>
    );
  }

  const [stats, favorites, reviews, followerCount, followingCount, currentlyFollowing, publicShelves] = await Promise.all([
    getUserStats(user.id),
    getUserFavorites(user.id),
    getUserReviewsWithBooks(user.id, 500),
    getFollowerCount(user.id),
    getFollowingCount(user.id),
    session ? isFollowing(session.userId, user.id) : Promise.resolve(false),
    getPublicShelves(user.id),
  ]);

  // Filter out anonymous reviews for public view
  const publicReviews = reviews.filter((r) => !r.isAnonymous);

  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const hasSocials = user.instagram || user.tiktok || user.threads || user.twitter;

  return (
    <div className="space-y-6 lg:max-w-[60%] lg:mx-auto">
      {/* Profile header — desktop: 2 columns (info left, stats right) */}
      <div className="lg:flex lg:items-start lg:gap-8">
        {/* Left: avatar + info */}
        <div className="flex gap-4 lg:flex-1">
          {/* Avatar */}
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-3xl font-bold text-black overflow-hidden flex-shrink-0 shadow-[0_0_20px_rgba(163,230,53,0.3)]">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              (user.displayName || user.email)[0].toUpperCase()
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h1 className="text-foreground text-xl font-bold tracking-tight line-clamp-2 leading-tight">
                {user.displayName || user.username || user.email.split("@")[0]}
              </h1>
              <AccountBadge accountType={user.accountType} />
            </div>
            {user.username && (
              <p className="text-xs text-muted mt-0.5">@{user.username}</p>
            )}
            {user.bio && (
              <p className="text-sm text-foreground/90 mt-1 leading-relaxed whitespace-pre-line">{user.bio}</p>
            )}
            {/* Location — respect visibility setting */}
            {user.location && (
              user.locationVisibility === "public" || isOwner || (user.locationVisibility === "followers" && currentlyFollowing)
            ) && (
              <p className="text-xs text-muted mt-1 flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {user.location}
              </p>
            )}
            <p className="text-xs text-muted mt-1.5">
              Member since {memberSince}
            </p>
            {/* Follower/following counts + follow button */}
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-xs text-muted">
                {followerCount} {followerCount === 1 ? "follower" : "followers"} · {followingCount} following
              </p>
              {!isOwner && session && (
                <FollowButton
                  targetUserId={user.id}
                  initialIsFollowing={currentlyFollowing}
                />
              )}
            </div>
            {/* Social icons — inline on desktop */}
            {hasSocials && (
              <div className="hidden lg:block mt-2">
                <SocialIcons
                  instagram={user.instagram}
                  tiktok={user.tiktok}
                  threads={user.threads}
                  twitter={user.twitter}
                  className="!justify-start"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right: stats pills (desktop only) */}
        <div className="hidden lg:block lg:flex-shrink-0 lg:w-[200px]">
          <div className="rounded-xl border border-neon-purple/20 bg-neon-purple/8 p-4 text-center mb-2">
            <p className="text-3xl font-bold text-foreground">{stats.completed}</p>
            <p className="text-xs text-muted">Read</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-neon-blue/20 bg-neon-blue/8 p-2.5 text-center">
              <p className="text-xl font-bold text-foreground">{stats.currentlyReading}</p>
              <p className="text-[10px] text-muted">Reading</p>
            </div>
            <div className="rounded-xl border border-accent/30 bg-accent/15 p-2.5 text-center">
              <p className="text-xl font-bold text-foreground">{stats.tbr}</p>
              <p className="text-[10px] text-muted">TBR</p>
            </div>
          </div>
        </div>
      </div>

      {/* Social icons — mobile only (centered full width) */}
      {hasSocials && (
        <div className="lg:hidden">
          <SocialIcons
            instagram={user.instagram}
            tiktok={user.tiktok}
            threads={user.threads}
            twitter={user.twitter}
          />
        </div>
      )}

      {/* Stats row — mobile only */}
      <div className="grid grid-cols-3 gap-3 lg:hidden">
        <div className="rounded-xl border border-neon-purple/20 bg-neon-purple/8 p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.completed}</p>
          <p className="text-xs text-muted">Read</p>
        </div>
        <div className="rounded-xl border border-neon-blue/20 bg-neon-blue/8 p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.currentlyReading}</p>
          <p className="text-xs text-muted">Reading</p>
        </div>
        <div className="rounded-xl border border-accent/30 bg-accent/15 p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.tbr}</p>
          <p className="text-xs text-muted">TBR</p>
        </div>
      </div>

      {/* Favorites */}
      <FavoritesShelf favorites={favorites} />

      {/* Public Shelves */}
      <ProfileShelvesSection
        shelves={publicShelves}
        linkBase={`/u/${username}/shelves`}
        viewAllHref={`/u/${username}/shelves`}
        isOwner={false}
      />

      {/* Reviews (no anonymous, no journal) */}
      <PublicReviewHistory reviews={publicReviews} />
    </div>
  );
}
