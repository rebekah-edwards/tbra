import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { removeFromLibraryFor } from "@/lib/mutations/reading-state";

/**
 * DELETE /api/v1/books/[id]/library
 * "Remove Everything" — clears review, rating, editions, sessions, and the
 * reading-state row for this user+book. Matches the web's destructive
 * confirm flow; the native UI must confirm before calling.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id: bookId } = await ctx.params;
  await removeFromLibraryFor(user.userId, bookId);
  return jsonOk({ removed: true });
}
