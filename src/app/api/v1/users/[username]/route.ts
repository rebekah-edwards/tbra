import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { getUserByUsername, getUserStats } from "@/lib/queries/profile";
import { getUserFavorites } from "@/lib/queries/favorites";
import { getUserReviewsWithBooks } from "@/lib/queries/user-reviews";
import { getFollowerCount, getFollowingCount, isFollowing } from "@/lib/queries/follows";
import { getPublicShelves } from "@/lib/queries/shelves";
import { followUserFor, unfollowUserFor } from "@/lib/actions/follows";

/**
 * GET /api/v1/users/[username] — the public profile payload, same
 * assembly + privacy gate as /u/[username].
 */
export async function GET(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const viewer = await getApiUser(req);
  if (!viewer) return jsonError("Unauthorized.", 401);

  const { username } = await ctx.params;
  const user = await getUserByUsername(username);
  if (!user) return jsonError("User not found.", 404);

  const isOwner = viewer.userId === user.id;
  if (user.isPrivate && !isOwner) {
    return jsonOk({ private: true, username });
  }

  const [stats, favorites, reviews, followerCount, followingCount, currentlyFollowing, publicShelves] = await Promise.all([
    getUserStats(user.id),
    getUserFavorites(user.id),
    getUserReviewsWithBooks(user.id, 500),
    getFollowerCount(user.id),
    getFollowingCount(user.id),
    isFollowing(viewer.userId, user.id),
    getPublicShelves(user.id),
  ]);

  return jsonOk({
    private: false,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio ?? null,
      accountType: user.accountType,
      createdAt: user.createdAt,
    },
    isOwner,
    isFollowing: currentlyFollowing,
    stats,
    favorites,
    // 500, matching the web /u page load — the native profile shows 5 and
    // its View-all screen searches/filters the rest client-side.
    reviews: reviews.filter((r) => !r.isAnonymous).slice(0, 500),
    followerCount,
    followingCount,
    publicShelves,
  });
}

/** POST /api/v1/users/[username]  { follow: true|false } */
export async function POST(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const viewer = await getApiUser(req);
  if (!viewer) return jsonError("Unauthorized.", 401);

  const { username } = await ctx.params;
  const user = await getUserByUsername(username);
  if (!user) return jsonError("User not found.", 404);

  const body = await parseJsonBody(req);
  const follow = body?.follow === true;
  const result = follow
    ? await followUserFor(viewer.userId, user.id)
    : await unfollowUserFor(viewer.userId, user.id);
  if (!result.success) return jsonError(result.error ?? "Couldn't update follow.", 400);
  return jsonOk({ following: follow });
}
