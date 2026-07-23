import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { db } from "@/db";
import { books, series, reportedIssues } from "@/db/schema";
import { eq, or } from "drizzle-orm";

/**
 * POST /api/v1/report  { pageUrl, description, bookSlug?, seriesSlug? }
 * Generic page-context issue report — bearer twin of the web's
 * GlobalReportButton → submitIssue flow. Drives the native floating
 * reporter available on every screen (super-admin + beta testers, same
 * gate the web layout applies to GlobalReportButton).
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl.slice(0, 500) : "";
  if (!description) return jsonError("Description is required.", 400);

  let bookId: string | null = null;
  if (typeof body?.bookSlug === "string" && body.bookSlug) {
    const b = await db
      .select({ id: books.id })
      .from(books)
      .where(or(eq(books.slug, body.bookSlug), eq(books.id, body.bookSlug)))
      .get();
    bookId = b?.id ?? null;
  }

  let seriesId: string | null = null;
  if (typeof body?.seriesSlug === "string" && body.seriesSlug) {
    const s = await db
      .select({ id: series.id })
      .from(series)
      .where(or(eq(series.slug, body.seriesSlug), eq(series.id, body.seriesSlug)))
      .get();
    seriesId = s?.id ?? null;
  }

  await db.insert(reportedIssues).values({
    userId: user.userId,
    bookId,
    seriesId,
    pageUrl: pageUrl || null,
    description,
  });

  return jsonOk({ reported: true });
}
