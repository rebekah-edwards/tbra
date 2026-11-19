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
import { ProfileHero } from "@/components/profile/profile-hero";
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
    <div className="space-y-7 lg:max-w-[60%] lg:mx-auto">
      <ProfileHero
        name={user.displayName || user.email.split("@")[0]}
        username={user.username}
        avatarUrl={user.avatarUrl}
        initial={(user.displayName || user.email)[0].toUpperCase()}
        accountType={user.accountType}
        bio={user.bio}
        location={user.location}
        memberSince={memberSince}
        followerCount={followerCount}
        followingCount={followingCount}
        stats={stats}
        statHrefs={{
          completed: "/library?tab=activity&filter=completed",
          currentlyReading: "/library?tab=activity&filter=currently_reading",
          tbr: "/library?tab=tbr",
        }}
        corner={user.username ? <ShareProfileButton username={user.username} /> : undefined}
        actions={
          <>
            <Link href="/profile/edit" className="btn-glass px-5 py-2 text-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              Edit Profile
            </Link>
            {user.username && (
              <Link href={`/u/${user.username}`} className="btn-glass px-5 py-2 text-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-purple" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Public view
              </Link>
            )}
          </>
        }
      />

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
      <ReviewHistory reviews={reviews} avatarUrl={user.avatarUrl} />

      {/* Reading Journal */}
      <ReadingJournal notes={journalNotes} />

      {/* Import Library */}
      <Link
        href="/import"
        className="flex items-center gap-3 rounded-[18px] border border-foreground/10 bg-surface/60 p-4 backdrop-blur-md transition-colors hover:border-foreground/25"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-foreground/12 bg-surface/70">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-medium">Import your library</p>
          <p className="text-xs text-muted">Bring books, ratings, and reading history from StoryGraph or Goodreads</p>
        </div>
      </Link>
    </div>
  );
}
