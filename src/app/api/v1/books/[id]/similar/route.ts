import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { resolveBook } from "@/lib/queries/books";
import { getSimilarBooks } from "@/lib/queries/recommendations";

/**
 * GET /api/v1/books/[id]/similar — the More Like This rail,
 * personalized (same query as /api/books/similar).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const results = await getSimilarBooks(resolved.book.id, user.userId);
  return jsonOk({
    results: results.map((b) => ({
      id: b.id,
      slug: b.slug,
      title: b.title,
      coverImageUrl: b.coverImageUrl,
      authors: b.authors,
      reason: b.reason ?? null,
      hasContentConflict: (b.contentWarnings?.length ?? 0) > 0,
    })),
  });
}
