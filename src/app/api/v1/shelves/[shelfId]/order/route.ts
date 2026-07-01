import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shelves, shelfBooks } from "@/db/schema";
import { getApiUser } from "@/lib/auth";
import { reorderShelfBooksFor } from "@/lib/mutations/shelves";
import { jsonError, jsonOk, parseJsonBody, asStringArray, sameMembers } from "@/lib/api/http";

/**
 * PUT /api/v1/shelves/:shelfId/order  { bookIds: [...] }
 * Set the order of books within a shelf (the native drag gesture). Owner only.
 * Must send the complete current set of the shelf's book IDs in the desired
 * order.
 */
export async function PUT(
  req: Request,
  context: { params: Promise<{ shelfId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId } = await context.params;
  const body = await parseJsonBody(req);
  const bookIds = body ? asStringArray(body.bookIds) : null;
  if (!bookIds) return jsonError("bookIds must be a non-empty array of strings.", 400);

  const shelf = await db
    .select({ userId: shelves.userId })
    .from(shelves)
    .where(eq(shelves.id, shelfId))
    .get();
  if (!shelf || shelf.userId !== user.userId) {
    return jsonError("Shelf not found.", 404);
  }

  const current = await db
    .select({ bookId: shelfBooks.bookId })
    .from(shelfBooks)
    .where(eq(shelfBooks.shelfId, shelfId))
    .all();

  if (!sameMembers(bookIds, current.map((r) => r.bookId))) {
    return jsonError("bookIds must be exactly the books on this shelf.", 400);
  }

  await reorderShelfBooksFor(user.userId, shelfId, bookIds);
  return jsonOk();
}
