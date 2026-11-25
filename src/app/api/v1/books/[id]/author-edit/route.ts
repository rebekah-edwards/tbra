import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { resolveBook } from "@/lib/queries/books";
import { authorEditDescriptionFor, authorRateFor } from "@/lib/authors/claims";

/**
 * POST /api/v1/books/[id]/author-edit — the book's verified author only.
 *   { description: string }
 *   { categoryKey: string, intensity?: 0-4, notes?: string|null }
 *      (no intensity/notes = confirm the rating as-is)
 * Same core as the web author tools; every change is logged and reported to
 * staff (lib/authors/claims.ts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);
  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const bookId = resolved.book.id;

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  if (typeof body.description === "string") {
    const res = await authorEditDescriptionFor(user.userId, bookId, body.description);
    return res.success ? jsonOk({}) : jsonError(res.error, 400);
  }
  if (typeof body.categoryKey === "string") {
    const intensity = typeof body.intensity === "number" ? body.intensity : null;
    const notes = body.notes === undefined ? undefined : typeof body.notes === "string" ? body.notes : null;
    const res = await authorRateFor(user.userId, bookId, body.categoryKey, { intensity, notes });
    return res.success ? jsonOk({}) : jsonError(res.error, 400);
  }
  return jsonError("Provide { description } or { categoryKey }.", 400);
}
