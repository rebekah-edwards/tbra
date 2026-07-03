import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { resolveSeries, getSeriesBooks, getSeriesBooksBySlug } from "@/lib/queries/books";

/**
 * GET /api/v1/series/[slug]  (slug or id)
 * The series page payload — same queries as /series/[slug]; the native
 * client derives Core/All/Sets exactly like series-books-view.tsx.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { slug } = await ctx.params;
  const resolved = await resolveSeries(slug);
  if (!resolved) return jsonError("Series not found.", 404);

  const seriesData = resolved.isIdLookup
    ? await getSeriesBooks(resolved.series.id, user.userId)
    : await getSeriesBooksBySlug(slug, user.userId);
  if (!seriesData) return jsonError("Series not found.", 404);

  return jsonOk({
    id: resolved.series.id,
    name: seriesData.name,
    books: seriesData.books,
  });
}
