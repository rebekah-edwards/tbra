import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { resolveSeries, getSeriesBooks, getSeriesBooksBySlug, getChildSeries } from "@/lib/queries/books";
import { db } from "@/db";
import { series } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/v1/series/[slug]  (slug or id)
 * The series page payload — same queries as /series/[slug]; the native
 * client derives Core/All/Sets exactly like series-books-view.tsx.
 * Franchise data (2026-07-22): parentSeries (this series belongs to a
 * franchise) and childSeries (this series IS a franchise → the web renders
 * FranchiseSeriesGrid instead of the book list; the native client mirrors).
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

  const [childSeries, seriesRow] = await Promise.all([
    getChildSeries(resolved.series.id),
    db
      .select({ parentSeriesId: series.parentSeriesId })
      .from(series)
      .where(eq(series.id, resolved.series.id))
      .get(),
  ]);

  let parentSeries: { id: string; name: string; slug: string | null } | null = null;
  if (seriesRow?.parentSeriesId) {
    const parent = await db
      .select({ id: series.id, name: series.name, slug: series.slug })
      .from(series)
      .where(eq(series.id, seriesRow.parentSeriesId))
      .get();
    parentSeries = parent ?? null;
  }

  return jsonOk({
    id: resolved.series.id,
    name: seriesData.name,
    books: seriesData.books,
    parentSeries,
    childSeries,
  });
}
