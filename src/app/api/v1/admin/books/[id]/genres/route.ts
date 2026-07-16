import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { genres, bookGenres } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireApiAdmin } from "@/lib/api/admin";
import { resolveBook } from "@/lib/queries/books";
import { titleCaseGenre } from "@/lib/enrichment/sanitize";

/**
 * POST /api/v1/admin/books/[id]/genres — { add: name } | { remove: name }
 * Mirrors actions/books.ts addBookGenre / removeBookGenre.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const bookId = resolved.book.id;

  let body: { add?: string; remove?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid body.", 400);
  }

  if (body.add) {
    const normalized = titleCaseGenre(body.add.trim());
    if (!normalized) return jsonError("Empty genre name.", 400);
    let genre = await db.select().from(genres).where(eq(genres.name, normalized)).get();
    if (!genre) {
      await db.insert(genres).values({ name: normalized });
      genre = await db.select().from(genres).where(eq(genres.name, normalized)).get();
    }
    if (!genre) return jsonError("Failed to create genre.", 500);
    await db.run(sql`INSERT OR IGNORE INTO book_genres (book_id, genre_id) VALUES (${bookId}, ${genre.id})`);
    return jsonOk({ name: normalized });
  }

  if (body.remove) {
    const genre = await db.select().from(genres).where(eq(genres.name, body.remove)).get();
    if (!genre) return jsonError("Genre not found.", 404);
    await db.delete(bookGenres).where(
      sql`${bookGenres.bookId} = ${bookId} AND ${bookGenres.genreId} = ${genre.id}`
    );
    return jsonOk({});
  }

  return jsonError("Provide add or remove.", 400);
}
