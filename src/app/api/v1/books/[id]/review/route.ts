import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { saveReviewFor, deleteReviewFor } from "@/lib/actions/review";
import { resolveBook } from "@/lib/queries/books";
import { getUserReview } from "@/lib/queries/review";
import { db } from "@/db";
import { userBookDimensionRatings, reviewDescriptorTags } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/v1/books/[id]/review — the user's existing review in the exact
 * shape the wizard needs for editing (dimension ratings, descriptor tags,
 * plot pacing, custom warning, comments).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const review = await getUserReview(user.userId, resolved.book.id);
  if (!review) return jsonOk({ review: null });

  const [dims, tags] = await Promise.all([
    db.select({ dimension: userBookDimensionRatings.dimension, rating: userBookDimensionRatings.rating })
      .from(userBookDimensionRatings)
      .where(eq(userBookDimensionRatings.reviewId, review.id))
      .all(),
    db.select({ dimension: reviewDescriptorTags.dimension, tag: reviewDescriptorTags.tag })
      .from(reviewDescriptorTags)
      .where(eq(reviewDescriptorTags.reviewId, review.id))
      .all(),
  ]);

  const dimensionRatings: Record<string, number> = {};
  for (const d of dims) dimensionRatings[d.dimension] = d.rating;

  const dimensionTags: Record<string, string[]> = {};
  let plotPacing: string | null = null;
  let customContentWarning = "";
  for (const t of tags) {
    if (t.dimension === "plot" && t.tag.startsWith("pacing:")) {
      plotPacing = t.tag.slice("pacing:".length);
      continue;
    }
    if (t.dimension === "content_details" && t.tag.startsWith("custom:")) {
      customContentWarning = t.tag.slice("custom:".length);
      continue;
    }
    (dimensionTags[t.dimension] ??= []).push(t.tag);
  }

  return jsonOk({
    review: {
      overallRating: review.overallRating,
      didNotFinish: review.didNotFinish ?? false,
      dnfPercentComplete: review.dnfPercentComplete ?? null,
      reviewText: review.reviewText ?? null,
      mood: review.mood ?? null,
      isAnonymous: review.isAnonymous ?? false,
      contentComments: review.contentComments ?? "",
      customContentWarning,
      plotPacing,
      dimensionRatings,
      dimensionTags,
    },
  });
}

/**
 * PUT /api/v1/books/[id]/review — create/update the review. Body mirrors
 * the wizard's saveReview payload (minus bookId, taken from the path).
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  await saveReviewFor(user.userId, {
    bookId: resolved.book.id,
    overallRating: typeof body.overallRating === "number" ? body.overallRating : null,
    didNotFinish: body.didNotFinish === true,
    dnfPercentComplete: typeof body.dnfPercentComplete === "number" ? body.dnfPercentComplete : null,
    reviewText: typeof body.reviewText === "string" && body.reviewText.trim() ? body.reviewText : null,
    mood: typeof body.mood === "string" ? body.mood : null,
    dimensionRatings: body.dimensionRatings ?? {},
    dimensionTags: body.dimensionTags ?? {},
    plotPacing: ["slow", "medium", "fast"].includes(body.plotPacing) ? body.plotPacing : null,
    customContentWarning: typeof body.customContentWarning === "string" && body.customContentWarning.trim() ? body.customContentWarning : null,
    contentComments: typeof body.contentComments === "string" && body.contentComments.trim() ? body.contentComments : null,
    isAnonymous: body.isAnonymous === true,
    arcSource: null,
    arcSourceDetail: null,
    arcProofUrl: null,
    proposedCorrections: Array.isArray(body.proposedCorrections)
      ? body.proposedCorrections
          .filter((p: unknown): p is { categoryKey: string; intensity: number; note?: string } =>
            !!p && typeof (p as { categoryKey?: unknown }).categoryKey === "string"
            && typeof (p as { intensity?: unknown }).intensity === "number")
          .map((p) => ({ categoryKey: p.categoryKey, intensity: p.intensity, note: p.note ?? null }))
      : [],
    userAddedWarnings: Array.isArray(body.userAddedWarnings)
      ? body.userAddedWarnings.filter((w: unknown): w is string => typeof w === "string")
      : [],
  });

  return jsonOk({ saved: true });
}

/** DELETE /api/v1/books/[id]/review — remove the review entirely. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  await deleteReviewFor(user.userId, resolved.book.id);
  return jsonOk({ deleted: true });
}
