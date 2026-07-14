import { getApiUser } from "@/lib/auth";
import { removeBookFromShelfFor, updateShelfBookNoteFor } from "@/lib/mutations/shelves";
import { jsonError, jsonOk } from "@/lib/api/http";

/**
 * DELETE /api/v1/shelves/:shelfId/books/:bookId
 * Remove a book from a shelf and re-compact positions. 404 if the shelf isn't
 * the user's. Idempotent — removing a book not on the shelf returns ok with
 * removed:false.
 */
export async function DELETE(
  req: Request,
  context: { params: Promise<{ shelfId: string; bookId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId, bookId } = await context.params;
  const result = await removeBookFromShelfFor(user.userId, shelfId, bookId);

  if (!result.success) {
    return jsonError("Shelf not found.", 404);
  }
  return jsonOk({ removed: result.removed ?? false });
}

/**
 * PATCH /api/v1/shelves/:shelfId/books/:bookId — set/clear the per-book
 * shelf note ("note to self"). Body: { note: string | null }.
 */
export async function PATCH(
  req: Request,
  context: { params: Promise<{ shelfId: string; bookId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId, bookId } = await context.params;
  let note: string | null;
  try {
    const body = await req.json();
    note = body.note ?? null;
    if (note !== null && typeof note !== "string") throw new Error();
  } catch {
    return jsonError("Invalid body — expected { note: string | null }.", 400);
  }

  const result = await updateShelfBookNoteFor(user.userId, shelfId, bookId, note);
  if (!result.success) return jsonError("Shelf not found.", 404);
  return jsonOk({});
}
