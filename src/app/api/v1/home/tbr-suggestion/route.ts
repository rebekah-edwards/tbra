import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getRandomOwnedTbrBook } from "@/lib/queries/tbr-suggestion";

/**
 * GET /api/v1/home/tbr-suggestion
 * A random owned + unread TBR book ("Pick From Your Shelf" shuffle).
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const suggestion = await getRandomOwnedTbrBook(user.userId);
  return jsonOk({ suggestion });
}
