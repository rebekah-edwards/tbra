import { getApiUser } from "@/lib/auth";
import { removeFromUpNextFor } from "@/lib/mutations/up-next";
import { jsonError, jsonOk } from "@/lib/api/http";

/**
 * DELETE /api/v1/up-next/:bookId
 * Remove a book from the queue and re-compact positions. Idempotent —
 * removing a book that isn't queued still returns ok.
 */
export async function DELETE(
  req: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { bookId } = await context.params;
  await removeFromUpNextFor(user.userId, bookId);
  return jsonOk();
}
