import { getApiUser, hasPremiumAccess } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { setAudioLengthFor } from "@/lib/mutations/custom-goals";

/** POST /api/v1/goals/audio-length  { bookId, minutes } — the reader's own audiobook length. */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);
  if (!hasPremiumAccess(user)) return jsonError("Custom goals are a Based Reader feature.", 403);

  const body = await parseJsonBody(req);
  if (!body || typeof body.bookId !== "string" || typeof body.minutes !== "number") {
    return jsonError("Expected { bookId, minutes }.", 400);
  }
  const result = await setAudioLengthFor(user.userId, body.bookId, body.minutes);
  if (!result.success) return jsonError(result.error ?? "Could not save length.", 400);
  return jsonOk({ ok: true });
}
