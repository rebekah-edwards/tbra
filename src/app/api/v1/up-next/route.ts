import { getApiUser } from "@/lib/auth";
import { getUserUpNext } from "@/lib/queries/up-next";
import { addToUpNextFor } from "@/lib/mutations/up-next";
import { jsonError, jsonOk, parseJsonBody, asString } from "@/lib/api/http";

/**
 * GET /api/v1/up-next
 * The signed-in user's Up Next queue (max 6), already ordered by position.
 * Reuses the existing query fn used by the web library page.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const items = await getUserUpNext(user.userId);
  return jsonOk({ items });
}

/**
 * POST /api/v1/up-next  { bookId }
 * Append a book to the queue. 409 if the queue is full.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const bookId = body ? asString(body.bookId) : null;
  if (!bookId) return jsonError("bookId is required.", 400);

  const result = await addToUpNextFor(user.userId, bookId);
  if (!result.success) {
    // The only failure is the capacity limit.
    return jsonError(result.error ?? "Could not add to Up Next.", 409);
  }
  return jsonOk({ position: result.position, added: result.added ?? false });
}
