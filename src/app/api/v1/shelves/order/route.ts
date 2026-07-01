import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shelves } from "@/db/schema";
import { getApiUser } from "@/lib/auth";
import { reorderShelvesFor } from "@/lib/mutations/shelves";
import { jsonError, jsonOk, parseJsonBody, asStringArray, sameMembers } from "@/lib/api/http";

/**
 * PUT /api/v1/shelves/order  { shelfIds: [...] }
 * Set the order of the user's shelves. Must send the complete current set of
 * the user's shelf IDs in the desired order.
 */
export async function PUT(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const shelfIds = body ? asStringArray(body.shelfIds) : null;
  if (!shelfIds) return jsonError("shelfIds must be a non-empty array of strings.", 400);

  const current = await db
    .select({ id: shelves.id })
    .from(shelves)
    .where(eq(shelves.userId, user.userId))
    .all();

  if (!sameMembers(shelfIds, current.map((r) => r.id))) {
    return jsonError("shelfIds must be exactly your current shelves.", 400);
  }

  await reorderShelvesFor(user.userId, shelfIds);
  return jsonOk();
}
