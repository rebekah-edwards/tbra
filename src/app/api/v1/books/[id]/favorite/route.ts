import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { resolveBook } from "@/lib/queries/books";
import { db } from "@/db";
import { userFavoriteBooks } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const MAX_FAVORITES = 50; // matches src/lib/actions/favorites.ts

/**
 * POST /api/v1/books/[id]/favorite — toggle Top Shelf pin (same rules
 * as the web toggleFavorite: 5 max, positions append).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const bookId = resolved.book.id;

  const existing = await db
    .select({ id: userFavoriteBooks.id, bookId: userFavoriteBooks.bookId })
    .from(userFavoriteBooks)
    .where(eq(userFavoriteBooks.userId, user.userId))
    .all();

  const mine = existing.find((f) => f.bookId === bookId);
  if (mine) {
    await db.delete(userFavoriteBooks).where(eq(userFavoriteBooks.id, mine.id));
    return jsonOk({ isFavorited: false });
  }

  if (existing.length >= MAX_FAVORITES) {
    return jsonError(`Top Shelf is full (${MAX_FAVORITES} max).`, 400);
  }

  await db.insert(userFavoriteBooks).values({
    userId: user.userId,
    bookId,
    position: existing.length + 1,
  });
  return jsonOk({ isFavorited: true });
}
