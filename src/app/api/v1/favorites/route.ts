import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getUserFavorites } from "@/lib/queries/favorites";
import { db } from "@/db";
import { userFavoriteBooks } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * GET /api/v1/favorites — the signed-in user's Top Shelf (same rows the
 * profile payload carries; standalone so the native Top Shelf screen can
 * refresh without refetching the whole profile).
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const favorites = await getUserFavorites(user.userId);
  return jsonOk({ favorites });
}

/**
 * PUT /api/v1/favorites — reorder the Top Shelf. Body: { bookIds } in the
 * desired order. Two-phase position write (negative first) to dodge the
 * UNIQUE(user_id, position) constraint, mirroring actions/favorites.ts.
 */
export async function PUT(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  let bookIds: string[];
  try {
    const body = await req.json();
    bookIds = body.bookIds;
    if (!Array.isArray(bookIds) || bookIds.some((id) => typeof id !== "string")) throw new Error();
  } catch {
    return jsonError("Invalid body — expected { bookIds: string[] }.", 400);
  }

  for (let i = 0; i < bookIds.length; i++) {
    await db.update(userFavoriteBooks).set({ position: -(i + 1) }).where(
      and(eq(userFavoriteBooks.userId, user.userId), eq(userFavoriteBooks.bookId, bookIds[i])),
    );
  }
  for (let i = 0; i < bookIds.length; i++) {
    await db.update(userFavoriteBooks).set({ position: i + 1 }).where(
      and(eq(userFavoriteBooks.userId, user.userId), eq(userFavoriteBooks.bookId, bookIds[i])),
    );
  }
  return jsonOk({});
}
