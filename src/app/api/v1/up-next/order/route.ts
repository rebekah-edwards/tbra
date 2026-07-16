import { eq } from "drizzle-orm";
import { db } from "@/db";
import { upNext } from "@/db/schema";
import { getApiUser } from "@/lib/auth";
import { reorderUpNextOrderFor } from "@/lib/mutations/up-next";
import { jsonError, jsonOk, parseJsonBody, asStringArray, sameMembers } from "@/lib/api/http";

/**
 * PUT /api/v1/up-next/order  { bookIds: [...] }
 * Set the whole queue order (the native drag gesture). The client must send
 * the COMPLETE current set of queued book IDs in the desired order — a partial
 * list is rejected (400), because up_next has a UNIQUE(user_id, position)
 * constraint that a partial renumber could violate.
 */
export async function PUT(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const bookIds = body ? asStringArray(body.bookIds) : null;
  if (!bookIds) return jsonError("bookIds must be a non-empty array of strings.", 400);

  const current = await db
    .select({ bookId: upNext.bookId })
    .from(upNext)
    .where(eq(upNext.userId, user.userId))
    .all();

  if (!sameMembers(bookIds, current.map((r) => r.bookId))) {
    return jsonError("bookIds must be exactly the current Up Next set.", 400);
  }

  await reorderUpNextOrderFor(user.userId, bookIds);
  return jsonOk();
}
