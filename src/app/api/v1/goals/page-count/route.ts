import { getApiUser, hasPremiumAccess } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { setPageCountFor } from "@/lib/mutations/custom-goals";

/** POST /api/v1/goals/page-count  { bookId, pages } — the reader's own page count. */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);
  if (!hasPremiumAccess(user)) return jsonError("Custom goals are a Based Reader feature.", 403);
  const body = await parseJsonBody(req);
  if (!body || typeof body.bookId !== "string" || typeof body.pages !== "number") {
    return jsonError("Expected { bookId, pages }.", 400);
  }
  const result = await setPageCountFor(user.userId, body.bookId, body.pages);
  if (!result.success) return jsonError(result.error ?? "Could not save.", 400);
  return jsonOk({ ok: true });
}
