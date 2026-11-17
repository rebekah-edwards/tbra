import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getFollowedUsersActivityPage } from "@/lib/queries/activity-feed";

/**
 * GET /api/v1/friends-activity?offset=0&limit=20
 * One page of the full friends activity feed — the endless list behind the
 * home rail's "See more". Responds { ok, items, nextOffset }; nextOffset is
 * null when there is nothing further to load.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const params = new URL(req.url).searchParams;
  const offset = clamp(params.get("offset"), 0, 5000, 0);
  const limit = clamp(params.get("limit"), 1, 30, 20);

  const page = await getFollowedUsersActivityPage(user.userId, offset, limit);
  return jsonOk({ items: page.items, nextOffset: page.nextOffset });
}

function clamp(raw: string | null, min: number, max: number, fallback: number): number {
  const value = raw === null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
