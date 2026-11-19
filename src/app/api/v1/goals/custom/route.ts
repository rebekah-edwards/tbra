import { getApiUser, hasPremiumAccess } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { getCustomGoals, getLibraryGenres } from "@/lib/queries/custom-goals";
import { setCustomGoalFor, removeCustomGoalFor } from "@/lib/mutations/custom-goals";

const PREMIUM_ONLY = "Custom goals are a Based Reader feature.";

/**
 * GET /api/v1/goals/custom?year=2026
 *   → { premium, goals: CustomGoalProgress[], genres: string[] }
 * Free readers get premium:false and an empty list (the app shows the
 * upgrade card); genres are the choices for a "Books in a genre" goal.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const premium = hasPremiumAccess(user);
  const yearParam = Number(new URL(req.url).searchParams.get("year"));
  const year = Number.isInteger(yearParam) && yearParam > 1900 ? yearParam : new Date().getFullYear();

  if (!premium) return jsonOk({ premium, year, goals: [], genres: [] });
  const [goals, genres] = await Promise.all([getCustomGoals(user.userId, year), getLibraryGenres(user.userId)]);
  return jsonOk({ premium, year, goals, genres });
}

/** POST /api/v1/goals/custom  { kind, target, genreName? } — create or update (current year). */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);
  if (!hasPremiumAccess(user)) return jsonError(PREMIUM_ONLY, 403);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const result = await setCustomGoalFor(user.userId, {
    kind: String(body.kind ?? ""),
    target: typeof body.target === "number" ? body.target : NaN,
    genreName: typeof body.genreName === "string" ? body.genreName : null,
  });
  if (!result.success) return jsonError(result.error ?? "Could not save goal.", 400);
  return jsonOk({ id: result.id });
}

/** DELETE /api/v1/goals/custom?id=… — soft-removes the goal. */
export async function DELETE(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonError("Missing id.", 400);
  await removeCustomGoalFor(user.userId, id);
  return jsonOk({ ok: true });
}
