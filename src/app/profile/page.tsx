import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, isPremium } from "@/lib/auth";

export const metadata: Metadata = {
  robots: { index: false },
};
import { getUser, getUserStats } from "@/lib/queries/profile";
import { getUserFavorites } from "@/lib/queries/favorites";
import { getUserReviewsWithBooks } from "@/lib/queries/user-reviews";
import { getRecentNotes } from "@/lib/queries/reading-notes";
import { getFollowerCount, getFollowingCount } from "@/lib/queries/follows";
import { FavoritesShelf } from "@/components/profile/favorites-shelf";
import { ReviewHistory } from "@/components/profile/review-history";
import { ReadingJournal } from "@/components/profile/reading-journal";
import { ShareProfileButton } from "@/components/profile/share-profile-button";
import { AccountBadge } from "@/components/profile/account-badge";
import { getUserShelves } from "@/lib/queries/shelves";
import { ProfileShelvesSection } from "@/components/shelves/profile-shelves-section";
import { ensureReferralCode, getReferralCount } from "@/lib/referrals";
import { ReferralCard } from "@/components/profile/referral-card";

export default async function ProfilePage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const user = await getUser(session.userId);
  if (!user) redirect("/login");

  const [stats, favorites, reviews, journalNotes, followerCount, followingCount, userShelves, referralCode, referralCount] = await Promise.all([
    getUserStats(session.userId),
    getUserFavorites(session.userId),
    getUserReviewsWithBooks(session.userId, 6),
    getRecentNotes(session.userId, 20),
    getFollowerCount(session.userId),
    getFollowingCount(session.userId),
    getUserShelves(session.userId),
    ensureReferralCode(session.userId),
    getReferralCount(session.userId),
  ]);

  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });


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
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2">
                <h1 className="text-foreground text-xl font-bold tracking-tight line-clamp-2 leading-tight">
                  {user.displayName || user.email.split("@")[0]}
                </h1>
                <AccountBadge accountType={user.accountType} />
              </div>
              {user.username && (
                <ShareProfileButton username={user.username} />
              )}
            </div>
            {user.username && (
              <p className="text-xs text-muted mt-0.5">@{user.username}</p>
            )}
            {user.bio && (
              <p className="text-sm text-foreground/90 mt-1 leading-relaxed whitespace-pre-line">{user.bio}</p>
            )}
            {user.location && (
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
            <div className="flex items-center gap-3 mt-1 text-sm">
              <span className="text-foreground"><strong>{followerCount}</strong> <span className="text-muted">followers</span></span>
              <span className="text-muted">·</span>
              <span className="text-foreground"><strong>{followingCount}</strong> <span className="text-muted">following</span></span>
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <Link
                href="/profile/edit"
                className="text-sm text-link hover:text-link/80"
              >
                Edit Profile
              </Link>
              {user.username && (
                <>
                  <span className="text-muted">·</span>
                  <Link
                    href={`/u/${user.username}`}
                    className="text-sm text-link hover:text-link/80 transition-colors"
                  >
                    View public profile
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: stats pills (desktop only — mobile shows below) */}
        <div className="hidden lg:block lg:flex-shrink-0 lg:w-[200px]">
          <Link href="/library?filter=completed" className="block rounded-xl border border-neon-purple/20 bg-neon-purple/8 p-4 text-center mb-2 hover:border-neon-purple/40 transition-colors">
            <p className="text-3xl font-bold text-foreground">{stats.completed}</p>
            <p className="text-xs text-muted">Read</p>
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/library?filter=currently_reading" className="rounded-xl border border-neon-blue/20 bg-neon-blue/8 p-2.5 text-center hover:border-neon-blue/40 transition-colors">
              <p className="text-xl font-bold text-foreground">{stats.currentlyReading}</p>
              <p className="text-[10px] text-muted">Reading</p>
            </Link>
            <Link href="/library?filter=tbr" className="rounded-xl border border-accent/30 bg-accent/15 p-2.5 text-center hover:border-accent/50 transition-colors">
              <p className="text-xl font-bold text-foreground">{stats.tbr}</p>
              <p className="text-[10px] text-muted">TBR</p>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats row — mobile only */}
      <div className="grid grid-cols-3 gap-3 lg:hidden">
        <Link href="/library?filter=completed" className="rounded-xl border border-neon-purple/20 bg-neon-purple/8 p-3 text-center hover:border-neon-purple/40 transition-colors">
          <p className="text-2xl font-bold text-foreground">{stats.completed}</p>
          <p className="text-xs text-muted">Read</p>
        </Link>
        <Link href="/library?filter=currently_reading" className="rounded-xl border border-neon-blue/20 bg-neon-blue/8 p-3 text-center hover:border-neon-blue/40 transition-colors">
          <p className="text-2xl font-bold text-foreground">{stats.currentlyReading}</p>
          <p className="text-xs text-muted">Reading</p>
        </Link>
        <Link href="/library?filter=tbr" className="rounded-xl border border-accent/30 bg-accent/15 p-3 text-center hover:border-accent/50 transition-colors">
          <p className="text-2xl font-bold text-foreground">{stats.tbr}</p>
          <p className="text-xs text-muted">TBR</p>
        </Link>
      </div>

      {/* Referral Card */}
      <ReferralCard code={referralCode} count={referralCount} />

      {/* Top-Shelf Reads */}
      <FavoritesShelf favorites={favorites} userAvatarUrl={user.avatarUrl} />

      {/* Custom Shelves */}
      <ProfileShelvesSection
        shelves={userShelves}
        linkBase="/library/shelves"
        viewAllHref="/library/shelves"
        isPremium={isPremium({ accountType: user.accountType })}
        isOwner={true}
      />

      {/* Recent Reviews */}
      <ReviewHistory reviews={reviews} />

      {/* Reading Journal */}
      <ReadingJournal notes={journalNotes} />

      {/* Import Library */}
      <Link
        href="/import"
        className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-primary/30 transition-colors"
      >
        <span className="text-lg">📥</span>
        <div>
          <p className="text-sm font-medium">Import your library</p>
          <p className="text-xs text-muted">Bring books, ratings, and reading history from StoryGraph or Goodreads</p>
        </div>
      </Link>
    </div>
  );
}
