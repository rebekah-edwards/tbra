import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getUser, getUserStats } from "@/lib/queries/profile";
import { getUserFavorites } from "@/lib/queries/favorites";
import { getUserReviewsWithBooks } from "@/lib/queries/user-reviews";
import { getRecentNotes } from "@/lib/queries/reading-notes";
import { getFollowerCount, getFollowingCount } from "@/lib/queries/follows";
import { getUserShelves } from "@/lib/queries/shelves";
import { ensureReferralCode, getReferralCount } from "@/lib/referrals";

/**
 * GET /api/v1/profile
 * The own-profile page payload — the exact query set of /profile.
 */
export async function GET(req: Request) {
  const apiUser = await getApiUser(req);
  if (!apiUser) return jsonError("Unauthorized.", 401);

  const user = await getUser(apiUser.userId);
  if (!user) return jsonError("User not found.", 404);

  const [stats, favorites, reviews, journalNotes, followerCount, followingCount, userShelves, referralCode, referralCount] = await Promise.all([
    getUserStats(apiUser.userId),
    getUserFavorites(apiUser.userId),
    getUserReviewsWithBooks(apiUser.userId, 6),
    getRecentNotes(apiUser.userId, 20),
    getFollowerCount(apiUser.userId),
    getFollowingCount(apiUser.userId),
    getUserShelves(apiUser.userId),
    ensureReferralCode(apiUser.userId),
    getReferralCount(apiUser.userId),
  ]);

  return jsonOk({
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      accountType: user.accountType,
      createdAt: user.createdAt,
      // Edit-Profile prefill (native, 2026-07-23)
      bio: user.bio ?? null,
      instagram: user.instagram ?? null,
      tiktok: user.tiktok ?? null,
      threads: user.threads ?? null,
      twitter: user.twitter ?? null,
      isPrivate: user.isPrivate ?? false,
    },
    stats,
    favorites,
    reviews,
    journalNotes,
    followerCount,
    followingCount,
    shelves: userShelves,
    referralCode,
    referralCount,
  });
}
