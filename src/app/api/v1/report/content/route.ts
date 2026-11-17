import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { getUserByUsername } from "@/lib/queries/profile";
import { reportContentFor } from "@/lib/actions/blocks";
import { db } from "@/db";
import { books } from "@/db/schema";
import { eq, or } from "drizzle-orm";

/**
 * POST /api/v1/report/content
 *   { kind: "review" | "profile", username, reason, details?, reviewId?, bookSlug? }
 *
 * Report a reader's review or profile as objectionable. Separate from
 * POST /api/v1/report (catalog/data issues): this one is the user-generated
 * content path App Review guideline 1.2 asks for, and it emails the admin.
 * `reason` is one of: spam, harassment, hate, sexual, spoilers, other.
 */
export async function POST(req: Request) {
  const viewer = await getApiUser(req);
  if (!viewer) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const kind = body?.kind === "review" ? "review" : body?.kind === "profile" ? "profile" : null;
  const username = typeof body?.username === "string" ? body.username : "";
  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (!kind || !username || !reason) return jsonError("kind, username and reason are required.", 400);

  const target = await getUserByUsername(username);
  if (!target) return jsonError("User not found.", 404);
  if (target.id === viewer.userId) return jsonError("You can't report yourself.", 400);

  let bookId: string | null = null;
  let pageUrl = `/u/${username}`;
  if (typeof body?.bookSlug === "string" && body.bookSlug) {
    const b = await db
      .select({ id: books.id, slug: books.slug })
      .from(books)
      .where(or(eq(books.slug, body.bookSlug), eq(books.id, body.bookSlug)))
      .get();
    bookId = b?.id ?? null;
    if (b?.slug) pageUrl = `/book/${b.slug}/reviews`;
  }

  const result = await reportContentFor(viewer.userId, {
    kind,
    targetUserId: target.id,
    reviewId: typeof body?.reviewId === "string" ? body.reviewId : null,
    bookId,
    reason,
    details: typeof body?.details === "string" ? body.details : null,
    pageUrl,
  });
  if (!result.success) return jsonError(result.error ?? "Couldn't send the report.", 400);
  return jsonOk({ reported: true });
}
