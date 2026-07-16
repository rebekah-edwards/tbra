import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { setReadingGoalFor } from "@/lib/mutations/reading-goals";

/**
 * POST /api/v1/reading-goal  { targetBooks }
 * Sets the current-year reading goal — same validation as the web action.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const target = body && typeof body.targetBooks === "number" ? Math.trunc(body.targetBooks) : NaN;

  const result = await setReadingGoalFor(user.userId, target);
  if (!result.success) return jsonError(result.error ?? "Could not set goal.", 400);
  return jsonOk({ targetBooks: target });
}
