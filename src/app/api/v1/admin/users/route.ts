import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { users, userFollows } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireApiSuperAdmin } from "@/lib/api/admin";

/**
 * GET /api/v1/admin/users — the native twin of /admin/users: every account,
 * newest first, with the viewer's follow state so the list can offer a
 * Follow button. Super-admin only.
 */
export async function GET(req: Request) {
  const admin = await requireApiSuperAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      username: users.username,
      avatarUrl: users.avatarUrl,
      accountType: users.accountType,
      createdAt: users.createdAt,
      followedId: userFollows.followedId,
    })
    .from(users)
    .leftJoin(
      userFollows,
      and(eq(userFollows.followedId, users.id), eq(userFollows.followerId, admin.userId))
    )
    .orderBy(desc(users.createdAt));

  return jsonOk({
    users: rows.map(({ followedId, ...u }) => ({ ...u, isFollowing: followedId != null })),
  });
}
