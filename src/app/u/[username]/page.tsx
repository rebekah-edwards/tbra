import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { users, userPreviousUsernames } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserByUsername, getUserStats } from "@/lib/queries/profile";
import { getUserFavorites } from "@/lib/queries/favorites";
import { getUserReviewsWithBooks } from "@/lib/queries/user-reviews";
import { getFollowerCount, getFollowingCount, isFollowing } from "@/lib/queries/follows";
import { getCurrentUser } from "@/lib/auth";
import { getBlockRelation } from "@/lib/queries/blocks";
import { getSharedNotes } from "@/lib/queries/reading-notes";
import { SharedNotes } from "@/components/profile/shared-notes";
import { SafetyMenu } from "@/components/safety/safety-menu";
import { UnblockButton } from "@/components/safety/unblock-button";
import { getPublicShelves } from "@/lib/queries/shelves";
import { FavoritesShelf } from "@/components/profile/favorites-shelf";
import { ProfileShelvesSection } from "@/components/shelves/profile-shelves-section";
import { getFollowedShelfIds } from "@/lib/mutations/shelves";
import { PublicReviewHistory } from "@/components/profile/public-review-history";
import { SocialIcons } from "@/components/profile/social-icons";
import { ProfileHero } from "@/components/profile/profile-hero";
import { FollowButton } from "@/components/profile/follow-button";
import { getVerifiedAuthorsForUser } from "@/lib/authors/claims";

/**
 * Look up a handle — first in the current users table, then in
 * user_previous_usernames (for users who changed their handle). Returns
 * { kind: 'current', user } if it matches a live username, or
 * { kind: 'redirect', username } if it matches an old username that should
 * redirect to the owner's new handle, or null if nothing matched.
 */
async function resolveHandle(
  rawHandle: string,
): Promise<
  | { kind: "current"; user: Awaited<ReturnType<typeof getUserByUsername>> }
  | { kind: "redirect"; username: string }
  | null
> {
  const handle = rawHandle.toLowerCase();
  const user = await getUserByUsername(handle);
  if (user) return { kind: "current", user };

  // Fall back to previous usernames — single JOIN to fetch the owner's
  // current handle in one round trip.
  const row = await db
    .select({ currentUsername: users.username })
    .from(userPreviousUsernames)
    .innerJoin(users, eq(userPreviousUsernames.userId, users.id))
    .where(eq(userPreviousUsernames.username, handle))
    .get();
  if (row?.currentUsername && row.currentUsername !== handle) {
    return { kind: "redirect", username: row.currentUsername };
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const resolved = await resolveHandle(username);
  if (!resolved || resolved.kind === "redirect") {
    // Redirect target — minimal metadata. The actual redirect happens in the
    // page body so the metadata never gets rendered for a redirected URL.
    return { title: "User Not Found | tbr*a" };
  }
  const user = resolved.user;
  if (!user) return { title: "User Not Found | tbr*a" };

  const displayName = user.displayName || user.username || user.email.split("@")[0];

  const canonicalUrl = `https://thebasedreader.app/u/${user.username}`;

  const title = `Follow ${displayName} on tbr*a | The Based Reader App`;
  const description = `Check out ${displayName}'s reading profile on tbr*a. See their top shelf reads, reviews, and what they're reading now.`;

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: "tbr*a",
      type: "profile",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "tbr*a — The Based Reader App",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const resolved = await resolveHandle(username);

  if (!resolved) {
    notFound();
  }
  if (resolved.kind === "redirect") {
    // 308 redirect old handle -> current handle so bookmarks and old links
    // survive. Next's redirect() issues a 307/308 which is preserved by
    // search engines as a permanent move.
    redirect(`/u/${resolved.username}`);
  }
  const user = resolved.user;
  if (!user) {
    notFound();
  }

  const session = await getCurrentUser();
  const isOwner = session?.userId === user.id;

  // Privacy gate — non-owners can't see private profiles
  if (user.isPrivate && !isOwner) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-foreground/12 bg-surface/70 backdrop-blur-md">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7 text-muted">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h1 className="font-heading text-foreground text-lg font-bold mb-1">This profile is private</h1>
        <p className="text-sm text-muted">@{username} has chosen to keep their reading life private.</p>
      </div>
    );
  }

  // Blocks (App Review 1.2). If the viewer blocked this reader, say so and
  // offer Unblock. If this reader blocked the viewer, show the same screen
  // as a private profile — a block is never announced to the person blocked.
  const relation = await getBlockRelation(session?.userId, user.id);
  if (relation.viewerBlocked || relation.blockedViewer) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-foreground/12 bg-surface/70 backdrop-blur-md">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-7 w-7 text-muted">
            {relation.viewerBlocked ? (
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" x2="19.07" y1="4.93" y2="19.07" />
              </>
            ) : (
              <>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </>
            )}
          </svg>
        </div>
        {relation.viewerBlocked ? (
          <>
            <h1 className="font-heading text-foreground text-lg font-bold mb-1">You blocked @{username}</h1>
            <p className="text-sm text-muted mb-4">You won&rsquo;t see each other&rsquo;s reviews or profiles.</p>
            <UnblockButton targetUserId={user.id} />
          </>
        ) : (
          <>
            <h1 className="font-heading text-foreground text-lg font-bold mb-1">This profile is private</h1>
            <p className="text-sm text-muted">@{username} has chosen to keep their reading life private.</p>
          </>
        )}
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

  // Shared reading notes are "visible to friends": the owner and followers.
  const sharedNotes = isOwner || currentlyFollowing ? await getSharedNotes(user.id, 10) : [];

  // Which of these shelves the viewer already follows, so the inline Follow
  // buttons render in the right state (punch list #5.2).
  const followedShelfIds =
    session && publicShelves.length > 0
      ? await getFollowedShelfIds(session.userId, publicShelves.map((s) => s.id))
      : [];

  // Filter out anonymous reviews for public view
  const publicReviews = reviews.filter((r) => !r.isAnonymous);

  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const hasSocials = user.instagram || user.tiktok || user.threads || user.twitter;

  const showLocation =
    !!user.location &&
    (user.locationVisibility === "public" || isOwner || (user.locationVisibility === "followers" && currentlyFollowing));

  const verifiedAuthors = await getVerifiedAuthorsForUser(user.id);

  return (
    <div className="space-y-7 lg:max-w-[60%] lg:mx-auto">
      <ProfileHero
        verifiedAuthors={verifiedAuthors}
        name={user.displayName || user.username || user.email.split("@")[0]}
        username={user.username}
        avatarUrl={user.avatarUrl}
        initial={(user.displayName || user.email)[0].toUpperCase()}
        accountType={user.accountType}
        bio={user.bio}
        location={showLocation ? user.location : null}
        memberSince={memberSince}
        followerCount={followerCount}
        followingCount={followingCount}
        stats={stats}
        corner={
          !isOwner && session ? (
            <SafetyMenu
              kind="profile"
              targetUserId={user.id}
              username={user.username}
              pageUrl={`/u/${user.username}`}
            />
          ) : undefined
        }
        actions={
          !isOwner && session ? (
            <FollowButton targetUserId={user.id} initialIsFollowing={currentlyFollowing} size="lg" />
          ) : isOwner ? (
            <Link href="/profile/edit" className="btn-glass px-5 py-2 text-sm">
              Edit Profile
            </Link>
          ) : (
            <Link
              href={`/signup?redirect=${encodeURIComponent(`/u/${user.username}`)}`}
              className="btn-lime px-6 py-2 text-sm"
            >
              Follow
            </Link>
          )
        }
        socials={
          hasSocials ? (
            <SocialIcons
              instagram={user.instagram}
              tiktok={user.tiktok}
              threads={user.threads}
              twitter={user.twitter}
              className="lg:!justify-start"
            />
          ) : undefined
        }
      />

      {/* Favorites */}
      <FavoritesShelf favorites={favorites} userAvatarUrl={user.avatarUrl} />

      {/* Public Shelves */}
      <ProfileShelvesSection
        shelves={publicShelves}
        linkBase={`/u/${username}/shelves`}
        viewAllHref={`/u/${username}/shelves`}
        isOwner={false}
        canFollow={!!session && session.userId !== user.id}
        followedShelfIds={followedShelfIds}
      />

      {/* Notes they chose to share — followers only */}
      <SharedNotes notes={sharedNotes} />

      {/* Reviews (no anonymous, no journal) */}
      <PublicReviewHistory reviews={publicReviews} />
    </div>
  );
}
