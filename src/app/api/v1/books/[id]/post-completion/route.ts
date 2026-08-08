import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { resolveBook } from "@/lib/queries/books";
import { getPostCompletionSuggestions } from "@/lib/queries/recommendations";
import type { RecommendedBook } from "@/lib/queries/recommendations";

/**
 * GET /api/v1/books/[id]/post-completion — the "What to Read Next" payload the
 * web shows in a bottom sheet after a book is marked Finished
 * (post-completion-suggestions.tsx, which reads it through a server action).
 * Native needs it over HTTP.
 */
const shape = (b: RecommendedBook) => ({
  id: b.id,
  slug: b.slug,
  title: b.title,
  coverImageUrl: b.coverImageUrl,
  authors: b.authors,
  reason: b.reason ?? null,
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const { seriesNext, similarBooks } = await getPostCompletionSuggestions(
    user.userId,
    resolved.book.id
  );

  return jsonOk({
    seriesNext: seriesNext ? shape(seriesNext) : null,
    // The web sheet caps its list at 6.
    similarBooks: similarBooks.slice(0, 6).map(shape),
  });
}
