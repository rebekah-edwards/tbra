import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { resolveBook } from "@/lib/queries/books";
import { saveTbrNoteFor, deleteTbrNoteFor } from "@/lib/actions/tbr-notes";

/**
 * PUT /api/v1/books/[id]/tbr-note  { note } — premium-gated "note to
 * self" on a TBR entry (same rules as the web: 500 chars, must be tbr).
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const body = await parseJsonBody(req);
  const note = typeof body?.note === "string" ? body.note : "";
  const result = await saveTbrNoteFor(user, resolved.book.id, note);
  if (!result.success) return jsonError(result.error ?? "Couldn't save the note.", 400);
  return jsonOk({ saved: true });
}

/** DELETE /api/v1/books/[id]/tbr-note */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const result = await deleteTbrNoteFor(user.userId, resolved.book.id);
  if (!result.success) return jsonError(result.error ?? "Couldn't delete the note.", 400);
  return jsonOk({ deleted: true });
}
