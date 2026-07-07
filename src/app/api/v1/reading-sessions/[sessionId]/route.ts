import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { updateReadingSessionFor, deleteReadingSessionFor } from "@/lib/actions/reading-session";

/**
 * PATCH /api/v1/reading-sessions/[sessionId]
 * Body: { startedAt?, completionDate?, activeFormats? } — the per-session
 * editor in Reading History (dates + format retro-tag).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { sessionId } = await ctx.params;
  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  const data: {
    startedAt?: string;
    completionDate?: string | null;
    activeFormats?: string[] | null;
  } = {};
  if (typeof body.startedAt === "string") data.startedAt = body.startedAt;
  if ("completionDate" in body) {
    data.completionDate = typeof body.completionDate === "string" ? body.completionDate : null;
  }
  if ("activeFormats" in body) {
    data.activeFormats = Array.isArray(body.activeFormats)
      ? body.activeFormats.filter((f: unknown): f is string => typeof f === "string")
      : null;
  }

  try {
    await updateReadingSessionFor(user.userId, sessionId, data);
  } catch {
    return jsonError("Session not found.", 404);
  }
  return jsonOk({ updated: true });
}

/** DELETE /api/v1/reading-sessions/[sessionId] */
export async function DELETE(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { sessionId } = await ctx.params;
  try {
    await deleteReadingSessionFor(user.userId, sessionId);
  } catch {
    return jsonError("Session not found.", 404);
  }
  return jsonOk({ deleted: true });
}
