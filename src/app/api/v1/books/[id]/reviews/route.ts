import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { resolveBook } from "@/lib/queries/books";
import { getBookReviews } from "@/lib/queries/review";
import { toggleHelpfulVoteFor } from "@/lib/actions/helpful";

/**
 * GET /api/v1/books/[id]/reviews — every review for the book (reviewer
 * info, ratings, dimension tags, helpful counts, viewer's votes), the
 * exact /book/[id]/reviews query.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const reviews = await getBookReviews(resolved.book.id, user.userId);
  return jsonOk({ reviews });
}

/** POST /api/v1/books/[id]/reviews  { helpfulReviewId } — toggle a helpful vote. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const body = await parseJsonBody(req);
  const reviewId = typeof body?.helpfulReviewId === "string" ? body.helpfulReviewId : null;
  if (!reviewId) return jsonError("helpfulReviewId required.", 400);

  await toggleHelpfulVoteFor(user.userId, reviewId, resolved.book.id);
  return jsonOk({});
}
