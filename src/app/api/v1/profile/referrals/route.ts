import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getReferredUsers } from "@/lib/referrals";

/**
 * GET /api/v1/profile/referrals — who signed up through the caller's link.
 * Native equivalent of the web /profile/referrals page.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const referred = await getReferredUsers(user.userId);
  return jsonOk({
    referrals: referred.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      joinedAt: r.createdAt,
    })),
  });
}
