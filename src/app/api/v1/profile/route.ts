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
