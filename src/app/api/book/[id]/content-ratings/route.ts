import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookCategoryRatings, taxonomyCategories } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Returns every active taxonomy category joined with this book's current
 * intensity (null if the book isn't rated for that category yet).
 *
 * Used by the review wizard's "What's in this book?" step so reviewers
 * can propose corrections against the authoritative list of categories.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: bookId } = await context.params;

  // Pull every active category, left-joined with this book's ratings.
  const rows = await db
    .select({
      categoryKey: taxonomyCategories.key,
      categoryName: taxonomyCategories.name,
      intensity: bookCategoryRatings.intensity,
      notes: bookCategoryRatings.notes,
    })
    .from(taxonomyCategories)
    .leftJoin(
      bookCategoryRatings,
      and(
        eq(bookCategoryRatings.categoryId, taxonomyCategories.id),
        eq(bookCategoryRatings.bookId, bookId),
      ),
    )
    .where(eq(taxonomyCategories.active, true));

  return NextResponse.json({
    ratings: rows.map((r) => ({
      categoryKey: r.categoryKey,
      categoryName: r.categoryName,
      intensity: r.intensity,
      notes: r.notes,
    })),
  });
}
