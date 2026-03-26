"use server";

import { db } from "@/db";
import { reportCorrections, taxonomyCategories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { bookCategoryRatings } from "@/db/schema";

export async function submitCorrection(
  bookId: string,
  categoryKey: string | null,
  proposedIntensity: number | null,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Must be logged in to submit corrections" };
  }

  if (!message.trim() || message.trim().length < 10) {
    return { success: false, error: "Please provide a description (at least 10 characters)" };
  }

  if (message.trim().length > 500) {
    return { success: false, error: "Description must be 500 characters or fewer" };
  }

  let categoryId: string | null = null;
  if (categoryKey) {
    const cat = await db.query.taxonomyCategories.findFirst({
      where: eq(taxonomyCategories.key, categoryKey),
    });
    categoryId = cat?.id ?? null;
  }

  // Admin submissions are auto-accepted and applied immediately
  const adminSubmission = isAdmin(user);
  const status = adminSubmission ? "accepted" : "new";

  await db.insert(reportCorrections).values({
    userId: user.userId,
    bookId,
    categoryId,
    proposedIntensity,
    message: message.trim(),
    status,
  });

  // Auto-apply admin corrections to book_category_ratings
  if (adminSubmission && categoryId && proposedIntensity !== null) {
    const existing = await db.query.bookCategoryRatings.findFirst({
      where: (bcr, { and, eq: e }) => and(e(bcr.bookId, bookId), e(bcr.categoryId, categoryId)),
    });

    if (existing) {
      await db.update(bookCategoryRatings)
        .set({
          intensity: proposedIntensity,
          notes: message.trim(),
          evidenceLevel: "human_verified",
          updatedByUserId: user.userId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(bookCategoryRatings.id, existing.id));
    } else {
      await db.insert(bookCategoryRatings).values({
        bookId,
        categoryId,
        intensity: proposedIntensity,
        notes: message.trim(),
        evidenceLevel: "human_verified",
        updatedByUserId: user.userId,
      });
    }
  }

  return { success: true };
}
