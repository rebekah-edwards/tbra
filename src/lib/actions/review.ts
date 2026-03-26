"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  userBookReviews,
  userBookDimensionRatings,
  reviewDescriptorTags,
  userBookRatings,
  bookCategoryRatings,
  taxonomyCategories,
  books,
  users,
} from "@/db/schema";
import { eq, and, count, like } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { CW_TO_TAXONOMY } from "@/lib/review-constants";

interface ReviewPayload {
  bookId: string;
  overallRating: number | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  reviewText: string | null;
  mood: string | null;
  dimensionRatings: Record<string, number | null>;
  dimensionTags: Record<string, string[]>;
  plotPacing?: "slow" | "medium" | "fast" | null;
  customContentWarning?: string | null;
  contentComments?: string | null;
  isAnonymous?: boolean;
}

export async function saveReview(payload: ReviewPayload) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const {
    bookId,
    overallRating,
    didNotFinish,
    dnfPercentComplete,
    reviewText,
    mood,
    dimensionRatings,
    dimensionTags,
    plotPacing,
    customContentWarning,
    contentComments,
    isAnonymous,
  } = payload;

  // Validate overall rating
  let validatedRating = overallRating;
  if (validatedRating !== null) {
    validatedRating = Math.round(validatedRating * 4) / 4;
    if (validatedRating < 0.25 || validatedRating > 5) validatedRating = null;
  }

  // Upsert review
  const existing = await db
    .select({ id: userBookReviews.id })
    .from(userBookReviews)
    .where(and(eq(userBookReviews.userId, user.userId), eq(userBookReviews.bookId, bookId)))
    .get();

  let reviewId: string;

  if (existing) {
    reviewId = existing.id;
    await db
      .update(userBookReviews)
      .set({
        overallRating: validatedRating,
        mood,
        moodIntensity: null,
        reviewText: reviewText || null,
        didNotFinish,
        dnfPercentComplete: didNotFinish ? dnfPercentComplete : null,
        isAnonymous: isAnonymous ?? false,
        contentComments: contentComments?.trim() || "",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userBookReviews.id, reviewId));
  } else {
    reviewId = crypto.randomUUID();
    await db.insert(userBookReviews).values({
      id: reviewId,
      userId: user.userId,
      bookId,
      overallRating: validatedRating,
      mood,
      moodIntensity: null,
      reviewText: reviewText || null,
      didNotFinish,
      dnfPercentComplete: didNotFinish ? dnfPercentComplete : null,
      isAnonymous: isAnonymous ?? false,
      contentComments: contentComments?.trim() || "",
    });
  }

  // Sync dimension ratings: delete all then re-insert
  await db.delete(userBookDimensionRatings).where(eq(userBookDimensionRatings.reviewId, reviewId));
  for (const [dimension, rating] of Object.entries(dimensionRatings)) {
    if (rating !== null && rating !== undefined) {
      const validated = Math.min(5, Math.max(0.25, Math.round(rating * 4) / 4));
      await db.insert(userBookDimensionRatings).values({
        reviewId,
        dimension,
        rating: validated,
      });
    }
  }

  // Sync descriptor tags: delete all then re-insert
  await db.delete(reviewDescriptorTags).where(eq(reviewDescriptorTags.reviewId, reviewId));
  for (const [dimension, tags] of Object.entries(dimensionTags)) {
    for (const tag of tags) {
      await db.insert(reviewDescriptorTags).values({
        reviewId,
        dimension,
        tag,
      });
    }
  }

  // Store plot pacing as a special tag in the "plot" dimension
  if (plotPacing) {
    await db.insert(reviewDescriptorTags).values({
      reviewId,
      dimension: "plot",
      tag: `pacing:${plotPacing}`,
    });
  }

  // Store custom content warning as a special tag
  if (customContentWarning && customContentWarning.trim()) {
    await db.insert(reviewDescriptorTags).values({
      reviewId,
      dimension: "content_details",
      tag: `custom:${customContentWarning.trim()}`,
    });
  }

  // Sync overall rating to userBookRatings for aggregate compatibility
  if (validatedRating !== null) {
    const existingRating = await db
      .select({ id: userBookRatings.id })
      .from(userBookRatings)
      .where(and(eq(userBookRatings.userId, user.userId), eq(userBookRatings.bookId, bookId)))
      .get();

    if (existingRating) {
      await db
        .update(userBookRatings)
        .set({ rating: validatedRating, updatedAt: new Date().toISOString() })
        .where(eq(userBookRatings.id, existingRating.id));
    } else {
      await db.insert(userBookRatings).values({
        userId: user.userId,
        bookId,
        rating: validatedRating,
      });
    }
  } else {
    // Remove rating if DNF or no rating
    await db
      .delete(userBookRatings)
      .where(and(eq(userBookRatings.userId, user.userId), eq(userBookRatings.bookId, bookId)));
  }

  // Process content warnings → What's Inside aggregation
  const cwTags = dimensionTags["content_details"] ?? [];
  await aggregateContentWarnings(bookId, cwTags);

  // Process pacing → book-level pacing aggregation
  await aggregatePacing(bookId);

  revalidatePath(`/book/${bookId}`);
}

export async function deleteReview(bookId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const existing = await db
    .select({ id: userBookReviews.id })
    .from(userBookReviews)
    .where(and(eq(userBookReviews.userId, user.userId), eq(userBookReviews.bookId, bookId)))
    .get();

  if (!existing) return;

  // Delete tags and dimension ratings first (foreign key deps)
  await db.delete(reviewDescriptorTags).where(eq(reviewDescriptorTags.reviewId, existing.id));
  await db.delete(userBookDimensionRatings).where(eq(userBookDimensionRatings.reviewId, existing.id));
  await db.delete(userBookReviews).where(eq(userBookReviews.id, existing.id));

  // Remove synced rating
  await db
    .delete(userBookRatings)
    .where(and(eq(userBookRatings.userId, user.userId), eq(userBookRatings.bookId, bookId)));

  // Re-aggregate content warnings without this review
  await aggregateContentWarnings(bookId, []);

  // Re-aggregate pacing without this review
  await aggregatePacing(bookId);

  revalidatePath(`/book/${bookId}`);
}

async function aggregateContentWarnings(bookId: string, _cwTags: string[]) {
  // Count how many reviewers have flagged each CW tag for this book
  const allReviewsForBook = await db
    .select({ tag: reviewDescriptorTags.tag })
    .from(reviewDescriptorTags)
    .innerJoin(userBookReviews, eq(reviewDescriptorTags.reviewId, userBookReviews.id))
    .where(
      and(
        eq(userBookReviews.bookId, bookId),
        eq(reviewDescriptorTags.dimension, "content_details")
      )
    )
    .all();

  // Count occurrences per tag (skip custom: and pacing: prefixed tags)
  const tagCounts: Record<string, number> = {};
  for (const row of allReviewsForBook) {
    if (row.tag.startsWith("custom:") || row.tag.startsWith("pacing:")) continue;
    tagCounts[row.tag] = (tagCounts[row.tag] || 0) + 1;
  }

  // Map to taxonomy categories and aggregate
  const categoryCounts: Record<string, number> = {};
  for (const [tag, tagCount] of Object.entries(tagCounts)) {
    const categoryKey = CW_TO_TAXONOMY[tag];
    if (!categoryKey) continue;
    categoryCounts[categoryKey] = Math.max(categoryCounts[categoryKey] || 0, tagCount);
  }

  // Update bookCategoryRatings for categories with 2+ flags
  for (const [categoryKey, flagCount] of Object.entries(categoryCounts)) {
    if (flagCount < 2) continue;

    // Look up taxonomy category
    const category = await db
      .select({ id: taxonomyCategories.id })
      .from(taxonomyCategories)
      .where(eq(taxonomyCategories.key, categoryKey))
      .get();
    if (!category) continue;

    // Derive intensity: 2 flags = 1, 4+ = 2, 8+ = 3, 15+ = 4
    const intensity = flagCount >= 15 ? 4 : flagCount >= 8 ? 3 : flagCount >= 4 ? 2 : 1;

    // Only update if not already human_verified by an admin
    const existing = await db
      .select({ id: bookCategoryRatings.id, evidenceLevel: bookCategoryRatings.evidenceLevel })
      .from(bookCategoryRatings)
      .where(
        and(
          eq(bookCategoryRatings.bookId, bookId),
          eq(bookCategoryRatings.categoryId, category.id)
        )
      )
      .get();

    if (existing && existing.evidenceLevel === "human_verified") continue;

    const notes = `Flagged by ${flagCount} reviewer${flagCount === 1 ? "" : "s"}`;

    if (existing) {
      await db
        .update(bookCategoryRatings)
        .set({ intensity, notes, evidenceLevel: "human_verified", updatedAt: new Date().toISOString() })
        .where(eq(bookCategoryRatings.id, existing.id));
    } else {
      await db.insert(bookCategoryRatings).values({
        bookId,
        categoryId: category.id,
        intensity,
        notes,
        evidenceLevel: "human_verified",
      });
    }
  }
}

async function aggregatePacing(bookId: string) {
  // Fetch all pacing tags for this book, with the reviewer's account type
  const rows = await db
    .select({
      tag: reviewDescriptorTags.tag,
      accountType: users.accountType,
    })
    .from(reviewDescriptorTags)
    .innerJoin(userBookReviews, eq(reviewDescriptorTags.reviewId, userBookReviews.id))
    .innerJoin(users, eq(userBookReviews.userId, users.id))
    .where(
      and(
        eq(userBookReviews.bookId, bookId),
        eq(reviewDescriptorTags.dimension, "plot"),
        like(reviewDescriptorTags.tag, "pacing:%")
      )
    )
    .all();

  let pacing: string | null = null;

  // Super admin pacing is authoritative
  for (const row of rows) {
    if (row.accountType === "super_admin") {
      pacing = row.tag.slice(7); // strip "pacing:" prefix
      break;
    }
  }

  // Otherwise, need 3+ reviews with pacing for community consensus
  if (!pacing && rows.length >= 3) {
    const counts: Record<string, number> = { slow: 0, medium: 0, fast: 0 };
    for (const row of rows) {
      const val = row.tag.slice(7);
      if (val in counts) counts[val]++;
    }
    // Majority wins
    pacing = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  await db
    .update(books)
    .set({ pacing, updatedAt: new Date().toISOString() })
    .where(eq(books.id, bookId));
}
