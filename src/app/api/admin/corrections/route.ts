import { NextResponse } from "next/server";
import { db } from "@/db";
import { reportCorrections, books, users, taxonomyCategories } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/**
 * GET /api/admin/corrections
 *
 * Returns correction reports with book/category/user info.
 * Query params:
 *   ?status=new|triaged|accepted|rejected  (default: new)
 *   ?limit=50 (default: 50, max: 200)
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "new";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);

  const corrections = await db
    .select({
      id: reportCorrections.id,
      status: reportCorrections.status,
      message: reportCorrections.message,
      proposedIntensity: reportCorrections.proposedIntensity,
      proposedNotes: reportCorrections.proposedNotes,
      createdAt: reportCorrections.createdAt,
      bookId: reportCorrections.bookId,
      bookTitle: books.title,
      userId: reportCorrections.userId,
      userEmail: users.email,
      categoryId: reportCorrections.categoryId,
      categoryName: taxonomyCategories.name,
      categoryKey: taxonomyCategories.key,
    })
    .from(reportCorrections)
    .leftJoin(books, eq(reportCorrections.bookId, books.id))
    .leftJoin(users, eq(reportCorrections.userId, users.id))
    .leftJoin(taxonomyCategories, eq(reportCorrections.categoryId, taxonomyCategories.id))
    .where(eq(reportCorrections.status, status))
    .orderBy(desc(reportCorrections.createdAt))
    .limit(limit);

  // Status counts for tab badges
  const statusCounts = await db.all<{ status: string; count: number }>(sql`
    SELECT status, count(*) as count
    FROM report_corrections
    GROUP BY status
  `);

  const counts: Record<string, number> = {};
  for (const row of statusCounts) {
    counts[row.status] = row.count;
  }

  return NextResponse.json({ corrections, counts });
}
