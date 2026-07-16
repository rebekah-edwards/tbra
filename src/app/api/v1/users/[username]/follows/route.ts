import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getUserByUsername } from "@/lib/queries/profile";
import { getFollowers, getFollowing } from "@/lib/queries/follows";

/**
 * GET /api/v1/users/[username]/follows?type=followers|following
 * The /u/[username]/followers + /following lists.
 */
export async function GET(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const viewer = await getApiUser(req);
  if (!viewer) return jsonError("Unauthorized.", 401);

  const { username } = await ctx.params;
  const user = await getUserByUsername(username);
  if (!user) return jsonError("User not found.", 404);

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "following" ? "following" : "followers";
  const list = type === "following"
    ? await getFollowing(user.id)
    : await getFollowers(user.id);

  return jsonOk({ type, users: list });
}
