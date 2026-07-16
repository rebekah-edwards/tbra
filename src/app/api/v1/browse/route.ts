import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { getBrowseBooks, type BrowseFilters } from "@/lib/queries/browse";
import { getFollowedUserIds } from "@/lib/queries/follows";

/**
 * POST /api/v1/browse — the Browse All Books catalog (same filters +
 * pagination as /api/browse).
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = (await parseJsonBody(req)) ?? {};
  const filters: BrowseFilters = {
    genre: body.genre || undefined,
    fiction: body.fiction || undefined,
    audience: body.audience || undefined,
    length: body.length || undefined,
    owned: body.owned || undefined,
    social: body.social || undefined,
    query: body.query || undefined,
    sort: body.sort || undefined,
  };
  const offset = Math.max(0, parseInt(body.offset, 10) || 0);
  const limit = Math.min(48, Math.max(1, parseInt(body.limit, 10) || 24));

  let followedIds: string[] = [];
  if (filters.social === "friends_read" || filters.social === "friends_tbr") {
    followedIds = [...(await getFollowedUserIds(user.userId))];
  }

  const result = await getBrowseBooks(filters, user.userId, followedIds, offset, limit);
  return jsonOk(result);
}
