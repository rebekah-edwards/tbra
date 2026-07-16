import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { bookCategoryRatings, taxonomyCategories } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { requireApiAdmin } from "@/lib/api/admin";
import { resolveBook } from "@/lib/queries/books";

/**
 * POST /api/v1/admin/books/[id]/content-verify — bearer twin of the web's
 * content-verify server actions (src/lib/actions/content-verify.ts), for the
 * native What's Inside admin tools.
 *
 * Bodies:
 *   { all: true }                                  → Verify All
 *   { categoryKey, intensity (0-4), notes? }       → edit + verify one category
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const bookId = resolved.book.id;

  let body: { all?: boolean; categoryKey?: string; intensity?: number; notes?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid body.", 400);
  }

  const now = new Date().toISOString();

  if (body.all) {
    const result = await db
      .update(bookCategoryRatings)
      .set({ evidenceLevel: "human_verified", updatedByUserId: admin.userId, updatedAt: now })
      .where(and(
        eq(bookCategoryRatings.bookId, bookId),
        ne(bookCategoryRatings.evidenceLevel, "human_verified"),
      ));
    return jsonOk({ count: result.rowsAffected ?? 0 });
  }

  if (!body.categoryKey) return jsonError("categoryKey required.", 400);
  const intensity = body.intensity;
  if (typeof intensity !== "number" || intensity < 0 || intensity > 4 || !Number.isInteger(intensity)) {
    return jsonError("intensity must be an integer 0-4.", 400);
  }
  const category = await db.select({ id: taxonomyCategories.id })
    .from(taxonomyCategories)
    .where(eq(taxonomyCategories.key, body.categoryKey))
    .get();
  if (!category) return jsonError("Unknown category.", 404);

  const trimmed = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null;
  await db
    .update(bookCategoryRatings)
    .set({
      intensity,
      notes: trimmed || null,
      evidenceLevel: "human_verified",
      updatedByUserId: admin.userId,
      updatedAt: now,
    })
    .where(and(
      eq(bookCategoryRatings.bookId, bookId),
      eq(bookCategoryRatings.categoryId, category.id),
    ));
  return jsonOk({});
}
