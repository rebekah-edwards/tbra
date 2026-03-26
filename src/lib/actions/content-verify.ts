"use server";

import { db } from "@/db";
import { bookCategoryRatings, taxonomyCategories } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export async function verifyContentRatings(
  bookId: string
): Promise<{ success: boolean; count: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return { success: false, count: 0, error: "Unauthorized" };
  }

  const result = await db
    .update(bookCategoryRatings)
    .set({
      evidenceLevel: "human_verified",
      updatedByUserId: user.userId,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(bookCategoryRatings.bookId, bookId),
        ne(bookCategoryRatings.evidenceLevel, "human_verified")
      )
    )
    .run();

  return { success: true, count: result.changes };
}

export async function adminUpdateRating(
  bookId: string,
  categoryKey: string,
  intensity: number,
  notes: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") {
      return { success: false, error: "Unauthorized" };
    }

    if (intensity < 0 || intensity > 4) {
      return { success: false, error: "Intensity must be 0–4" };
    }

    const category = await db.query.taxonomyCategories.findFirst({
      where: eq(taxonomyCategories.key, categoryKey),
    });
    if (!category) {
      return { success: false, error: "Category not found" };
    }

    await db.update(bookCategoryRatings)
      .set({
        intensity,
        notes: notes?.trim() || null,
        evidenceLevel: "human_verified",
        updatedByUserId: user.userId,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(bookCategoryRatings.bookId, bookId),
          eq(bookCategoryRatings.categoryId, category.id)
        )
      )
      .run();

    return { success: true };
  } catch (err) {
    console.error("[adminUpdateRating] Error:", err);
    return { success: false, error: "Server error — see logs" };
  }
}
