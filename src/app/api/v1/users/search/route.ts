import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { users, userFollows } from "@/db/schema";
import { like, or, ne, and, eq, inArray } from "drizzle-orm";

/**
 * GET /api/v1/users/search?q= — reader directory search (same query as
 * /api/users/search) + isFollowing per row for the native Follow pills.
 */
export async function GET(req: Request) {
  const viewer = await getApiUser(req);
  if (!viewer) return jsonError("Unauthorized.", 401);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return jsonOk({ results: [] });

  const pattern = `%${q}%`;
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
    })
    .from(users)
    .where(and(
      or(like(users.displayName, pattern), like(users.username, pattern)),
      ne(users.id, viewer.userId),
    ))
    .limit(20)
    .all();

  let followedIds = new Set<string>();
  if (rows.length > 0) {
    const follows = await db
      .select({ followedId: userFollows.followedId })
      .from(userFollows)
      .where(and(
        eq(userFollows.followerId, viewer.userId),
        inArray(userFollows.followedId, rows.map((r) => r.id)),
      ))
      .all();
    followedIds = new Set(follows.map((f) => f.followedId));
  }

  return jsonOk({
    results: rows.map((r) => ({ ...r, isFollowing: followedIds.has(r.id) })),
  });
}
