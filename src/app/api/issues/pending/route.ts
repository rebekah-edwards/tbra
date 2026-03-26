import { NextResponse } from "next/server";
import { db } from "@/db";
import { reportedIssues, books, series } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/issues/pending
 *
 * Returns all issues with status 'new', joined with book/series titles
 * for context. Used by the scheduled task to process reported issues.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const issues = db
    .select()
    .from(reportedIssues)
    .where(inArray(reportedIssues.status, ["new", "in_progress"]))
    .all();

  // Batch-fetch book and series titles for context
  const bookIds = [...new Set(issues.filter((i) => i.bookId).map((i) => i.bookId!))];
  const seriesIds = [...new Set(issues.filter((i) => i.seriesId).map((i) => i.seriesId!))];

  const bookTitles = new Map<string, string>();
  if (bookIds.length > 0) {
    const rows = db
      .select({ id: books.id, title: books.title })
      .from(books)
      .where(inArray(books.id, bookIds))
      .all();
    for (const r of rows) bookTitles.set(r.id, r.title);
  }

  const seriesNames = new Map<string, string>();
  if (seriesIds.length > 0) {
    const rows = db
      .select({ id: series.id, name: series.name })
      .from(series)
      .where(inArray(series.id, seriesIds))
      .all();
    for (const r of rows) seriesNames.set(r.id, r.name);
  }

  const enriched = issues.map((issue) => ({
    id: issue.id,
    bookId: issue.bookId,
    bookTitle: issue.bookId ? bookTitles.get(issue.bookId) ?? null : null,
    seriesId: issue.seriesId,
    seriesName: issue.seriesId ? seriesNames.get(issue.seriesId) ?? null : null,
    pageUrl: issue.pageUrl,
    description: issue.description,
    status: issue.status,
    createdAt: issue.createdAt,
  }));

  return NextResponse.json({ issues: enriched });
}
