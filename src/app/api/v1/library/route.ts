import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getUserBooks } from "@/lib/queries/reading-state";

/**
 * GET /api/v1/library
 * Every book in the user's library (states + owned), the same
 * UserBookWithDetails rows the web /library page loads. Grouping,
 * sub-filters, and sorting are client-side — identical to the web.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const books = await getUserBooks(user.userId);
  return jsonOk({ books });
}
