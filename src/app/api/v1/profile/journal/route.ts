import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getRecentNotes } from "@/lib/queries/reading-notes";

/**
 * GET /api/v1/profile/journal — the signed-in user's full reading-journal
 * history (the profile payload carries only the 20 most recent). Backs the
 * native profile's "View all entries" screen.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const notes = await getRecentNotes(user.userId, 500);
  return jsonOk({ notes });
}
