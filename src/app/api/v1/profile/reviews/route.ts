import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getUserReviewsWithBooks } from "@/lib/queries/user-reviews";

/**
 * GET /api/v1/profile/reviews — the signed-in user's full review history
 * (the profile payload itself carries only the 6 most recent). Backs the
 * native profile's "View all reviews" screen.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const reviews = await getUserReviewsWithBooks(user.userId, 500);
  return jsonOk({ reviews });
}
