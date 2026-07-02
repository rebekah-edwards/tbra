import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { setOwnedFormatsFor, setActiveFormatsFor } from "@/lib/mutations/reading-state";

const VALID = ["hardcover", "paperback", "ebook", "audiobook", "set", "unknown"];

/**
 * POST /api/v1/books/[id]/formats  { owned?: string[], active?: string[] }
 * Owned-formats editor and/or active-formats ("how I'm reading it") —
 * same rules as the web (unknown-placeholder drop, session mirroring).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id: bookId } = await ctx.params;
  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  const owned = Array.isArray(body.owned) ? body.owned.filter((f): f is string => typeof f === "string") : null;
  const active = Array.isArray(body.active) ? body.active.filter((f): f is string => typeof f === "string") : null;
  if (!owned && !active) return jsonError("Provide owned and/or active format arrays.", 400);
  for (const f of [...(owned ?? []), ...(active ?? [])]) {
    if (!VALID.includes(f)) return jsonError(`Invalid format: ${f}`, 400);
  }

  if (owned) await setOwnedFormatsFor(user.userId, bookId, owned);
  if (active) await setActiveFormatsFor(user.userId, bookId, active);
  return jsonOk({ owned, active });
}
