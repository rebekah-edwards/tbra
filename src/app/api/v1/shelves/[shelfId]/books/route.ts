import { getApiUser } from "@/lib/auth";
import { addBookToShelfFor } from "@/lib/mutations/shelves";
import { jsonError, jsonOk, parseJsonBody, asString, asOptionalString } from "@/lib/api/http";

/**
 * POST /api/v1/shelves/:shelfId/books  { bookId, note? }
 * Add a book to a shelf. 404 if the shelf isn't the user's; 400 if the shelf
 * is full. Idempotent — adding a book already on the shelf returns ok with
 * added:false.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ shelfId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId } = await context.params;
  const body = await parseJsonBody(req);
  const bookId = body ? asString(body.bookId) : null;
  if (!bookId) return jsonError("bookId is required.", 400);

  const note = body ? asOptionalString(body.note) : undefined;

  const result = await addBookToShelfFor(user.userId, shelfId, bookId, note ?? undefined);
  if (!result.success) {
    const status = result.error === "Shelf not found" ? 404 : 400; // 400 = shelf full
    return jsonError(result.error ?? "Could not add book to shelf.", status);
  }
  return jsonOk({ added: result.added ?? false });
}
