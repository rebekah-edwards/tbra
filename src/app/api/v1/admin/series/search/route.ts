import { jsonError, jsonOk } from "@/lib/api/http";
import { requireApiAdmin } from "@/lib/api/admin";
import { db } from "@/db";
import { series } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * GET /api/v1/admin/series/search?q=… — series eligible to be franchise
 * parents (no parent themselves). Bearer twin of the web's
 * searchSeriesForParent server action; drives the native "Assign to
 * franchise" picker.
 */
export async function GET(req: Request) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return jsonOk({ series: [] });

  const results = await db
    .select({ id: series.id, name: series.name, slug: series.slug })
    .from(series)
    .where(sql`LOWER(${series.name}) LIKE ${`%${q.toLowerCase()}%`} AND ${series.parentSeriesId} IS NULL`)
    .limit(10);

  return jsonOk({ series: results });
}
