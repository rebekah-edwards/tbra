import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getUserByUsername } from "@/lib/queries/profile";
import { blockUserFor, unblockUserFor } from "@/lib/actions/blocks";

/**
 * POST   /api/v1/users/[username]/block — block this reader.
 * DELETE /api/v1/users/[username]/block — unblock them.
 *
 * Blocking hides each reader from the other (reviews, profile, search,
 * buddy-read messages) and ends any follow between them. Required by App
 * Review guideline 1.2 for an app with user-generated content.
 */
async function resolve(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const viewer = await getApiUser(req);
  if (!viewer) return { error: jsonError("Unauthorized.", 401) } as const;
  const { username } = await ctx.params;
  const user = await getUserByUsername(username);
  if (!user) return { error: jsonError("User not found.", 404) } as const;
  return { viewer, user } as const;
}

export async function POST(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const r = await resolve(req, ctx);
  if ("error" in r) return r.error;
  const result = await blockUserFor(r.viewer.userId, r.user.id);
  if (!result.success) return jsonError(result.error ?? "Couldn't block this reader.", 400);
  return jsonOk({ blocked: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const r = await resolve(req, ctx);
  if ("error" in r) return r.error;
  const result = await unblockUserFor(r.viewer.userId, r.user.id);
  if (!result.success) return jsonError(result.error ?? "Couldn't unblock this reader.", 400);
  return jsonOk({ blocked: false });
}
