import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { getUserBuddyReads } from "@/lib/queries/buddy-reads";
import { createBuddyReadFor, joinBuddyReadByCodeFor } from "@/lib/actions/buddy-reads";
import { resolveBook } from "@/lib/queries/books";

/** GET /api/v1/buddy-reads — the user's buddy reads (active + invited). */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const buddyReads = await getUserBuddyReads(user.userId);
  return jsonOk({ buddyReads });
}

/**
 * POST /api/v1/buddy-reads
 *  { bookId, description?, isPublic? }  → create (auto-named from the book)
 *  { joinCode }                          → join by invite code
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  if (typeof body.joinCode === "string" && body.joinCode.trim()) {
    const result = await joinBuddyReadByCodeFor(user.userId, body.joinCode);
    if (!result.success) return jsonError(result.error ?? "Couldn't join.", 400);
    return jsonOk({ slug: result.slug });
  }

  if (typeof body.bookId === "string") {
    const resolved = await resolveBook(body.bookId);
    if (!resolved) return jsonError("Book not found.", 404);
    const result = await createBuddyReadFor(
      user.userId,
      resolved.book.id,
      typeof body.description === "string" ? body.description : undefined,
      body.isPublic === true,
    );
    if (!result.success) return jsonError(result.error ?? "Couldn't create.", 400);
    return jsonOk({ slug: result.slug });
  }

  return jsonError("Provide { bookId } or { joinCode }.", 400);
}
