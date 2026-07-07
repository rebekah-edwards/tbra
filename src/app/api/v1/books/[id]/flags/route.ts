import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { resolveBook } from "@/lib/queries/books";
import { db } from "@/db";
import { userHiddenBooks, reportedIssues } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/v1/books/[id]/flags
 * { hide: true|false }  — hide/unhide from recommendations (same writes
 *                          as the web hideBook/unhideBook)
 * { report: "<description>" } — file a reported_issues row (same insert
 *                          as the web submitIssue)
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const bookId = resolved.book.id;

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  if (typeof body.hide === "boolean") {
    if (body.hide) {
      const existing = await db
        .select({ bookId: userHiddenBooks.bookId })
        .from(userHiddenBooks)
        .where(and(eq(userHiddenBooks.userId, user.userId), eq(userHiddenBooks.bookId, bookId)))
        .get();
      if (!existing) {
        await db.insert(userHiddenBooks).values({ userId: user.userId, bookId });
      }
    } else {
      await db
        .delete(userHiddenBooks)
        .where(and(eq(userHiddenBooks.userId, user.userId), eq(userHiddenBooks.bookId, bookId)));
    }
    return jsonOk({ hidden: body.hide });
  }

  if (typeof body.report === "string" && body.report.trim()) {
    await db.insert(reportedIssues).values({
      userId: user.userId,
      bookId,
      seriesId: null,
      pageUrl: `/book/${resolved.book.slug ?? bookId}`,
      description: body.report.trim(),
    });
    return jsonOk({ reported: true });
  }

  return jsonError("Provide { hide } or { report }.", 400);
}
