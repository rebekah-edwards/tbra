import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { requireApiAdmin } from "@/lib/api/admin";
import { db } from "@/db";
import { series } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/v1/admin/series/[id]/parent  { parentSeriesId: string | null }
 * Assign a series to (or remove it from) a franchise. Bearer twin of the
 * web's setParentSeries server action — same single-level nesting rules.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);

  const { id } = await ctx.params;
  const body = await parseJsonBody(req);
  const parentSeriesId: string | null =
    typeof body?.parentSeriesId === "string" ? body.parentSeriesId : null;

  if (parentSeriesId) {
    if (parentSeriesId === id) return jsonError("Cannot parent a series to itself.", 400);
    const parent = await db
      .select({ id: series.id, parentSeriesId: series.parentSeriesId })
      .from(series)
      .where(eq(series.id, parentSeriesId))
      .get();
    if (!parent) return jsonError("Parent series not found.", 404);
    if (parent.parentSeriesId) return jsonError("Cannot nest more than one level deep.", 400);
  }

  const target = await db.select({ id: series.id }).from(series).where(eq(series.id, id)).get();
  if (!target) return jsonError("Series not found.", 404);

  await db.update(series).set({ parentSeriesId }).where(eq(series.id, id));
  return jsonOk({ parentSeriesId });
}
