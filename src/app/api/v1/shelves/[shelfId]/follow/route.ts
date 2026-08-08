import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { followShelfFor, unfollowShelfFor, isFollowingShelf } from "@/lib/mutations/shelves";

/** GET — is the caller following this shelf? */
export async function GET(req: Request, ctx: { params: Promise<{ shelfId: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId } = await ctx.params;
  return jsonOk({ following: await isFollowingShelf(user.userId, shelfId) });
}

/** POST — follow a public shelf. */
export async function POST(req: Request, ctx: { params: Promise<{ shelfId: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId } = await ctx.params;
  const result = await followShelfFor(user.userId, shelfId);
  if (!result.success) return jsonError(result.error ?? "Could not follow shelf.", 400);
  return jsonOk({ following: true });
}

/** DELETE — unfollow. */
export async function DELETE(req: Request, ctx: { params: Promise<{ shelfId: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId } = await ctx.params;
  await unfollowShelfFor(user.userId, shelfId);
  return jsonOk({ following: false });
}
