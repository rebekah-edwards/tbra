import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getBlockedUsers } from "@/lib/queries/blocks";

/** GET /api/v1/blocks — the readers the signed-in user has blocked (Settings list). */
export async function GET(req: Request) {
  const viewer = await getApiUser(req);
  if (!viewer) return jsonError("Unauthorized.", 401);
  return jsonOk({ blocked: await getBlockedUsers(viewer.userId) });
}
