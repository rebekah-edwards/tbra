"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userBookRatings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export async function setBookRating(bookId: string, rating: number | null) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Validate rating
  if (rating !== null) {
    if (rating < 0.25 || rating > 5) {
      throw new Error("Rating must be between 0.25 and 5");
    }
    // Snap to nearest quarter
    rating = Math.round(rating * 4) / 4;
  }

  const existing = await db
    .select()
    .from(userBookRatings)
    .where(
      and(
        eq(userBookRatings.userId, user.userId),
        eq(userBookRatings.bookId, bookId)
      )
    )
    .get();

  if (rating === null) {
    // Remove rating
    if (existing) {
      await db
        .delete(userBookRatings)
        .where(eq(userBookRatings.id, existing.id));
    }
  } else if (existing) {
    // Update rating
    await db
      .update(userBookRatings)
      .set({ rating, updatedAt: new Date().toISOString() })
      .where(eq(userBookRatings.id, existing.id));
  } else {
    // Insert rating
    await db.insert(userBookRatings).values({
      userId: user.userId,
      bookId,
      rating,
    });
  }

  revalidatePath(`/book/${bookId}`);
}
