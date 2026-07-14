import { getApiUser } from "@/lib/auth";
import { getShelfWithBooks } from "@/lib/queries/shelves";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { updateShelfFor, deleteShelfFor } from "@/lib/mutations/shelves";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  asOptionalString,
  asOptionalBoolean,
} from "@/lib/api/http";

/**
 * GET /api/v1/shelves/:shelfId
 * A single shelf, fully hydrated with its books in position order.
 *
 * Authorization: the owner may view their own (public or private) shelf;
 * other users may view it only if it's public. To avoid leaking the
 * existence of private shelves, an unauthorized/missing shelf both return
 * 404 with the same body.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ shelfId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) {
    return jsonError("Unauthorized.", 401);
  }

  const { shelfId } = await context.params;
  const shelf = await getShelfWithBooks(shelfId);

  if (!shelf || (shelf.userId !== user.userId && !shelf.isPublic)) {
    return jsonError("Shelf not found.", 404);
  }

  // Owner attribution for the native header ("by <name>" links to the
  // owner's profile; the avatar rides in the shelf-book rating pills).
  const ownerRows = await db.all(sql`
    SELECT username, display_name, avatar_url FROM users WHERE id = ${shelf.userId}
  `) as { username: string; display_name: string | null; avatar_url: string | null }[];
  const owner = ownerRows[0];

  return jsonOk({
    shelf: {
      ...shelf,
      ownerUsername: owner?.username ?? null,
      ownerDisplayName: owner?.display_name ?? null,
      ownerAvatarUrl: owner?.avatar_url ?? null,
    },
  });
}

/**
 * PATCH /api/v1/shelves/:shelfId  { name?, description?, isPublic?, color?, coverImageUrl? }
 * Update shelf metadata. Only the owner may update (non-owners get 404).
 */
export async function PATCH(
  req: Request,
  context: { params: Promise<{ shelfId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId } = await context.params;
  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  const result = await updateShelfFor(user.userId, shelfId, {
    name: asOptionalString(body.name) ?? undefined,
    description: asOptionalString(body.description),
    isPublic: asOptionalBoolean(body.isPublic),
    color: asOptionalString(body.color),
    coverImageUrl: asOptionalString(body.coverImageUrl),
  });

  if (!result.success) {
    // "Shelf not found" covers both missing and not-owned.
    const status = result.error === "Shelf not found" ? 404 : 400;
    return jsonError(result.error ?? "Could not update shelf.", status);
  }
  return jsonOk({ slug: result.slug });
}

/**
 * DELETE /api/v1/shelves/:shelfId
 * Delete a shelf (and its books, via cascade). Owner only.
 */
export async function DELETE(
  req: Request,
  context: { params: Promise<{ shelfId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { shelfId } = await context.params;
  const result = await deleteShelfFor(user.userId, shelfId);

  if (!result.success) {
    return jsonError(result.error ?? "Shelf not found.", 404);
  }
  return jsonOk();
}
