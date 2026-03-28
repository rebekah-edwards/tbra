import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { reportedIssues, books, users, series } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { IssuesTriageDashboard } from "@/components/admin/issues-triage";

export const dynamic = "force-dynamic";

export default async function AdminIssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  const { status: statusParam } = await searchParams;
  const activeStatus = statusParam ?? "new";

  // Fetch issues with joins
  const issues = await db
    .select({
      id: reportedIssues.id,
      status: reportedIssues.status,
      description: reportedIssues.description,
      pageUrl: reportedIssues.pageUrl,
      resolution: reportedIssues.resolution,
      createdAt: reportedIssues.createdAt,
      resolvedAt: reportedIssues.resolvedAt,
      bookId: reportedIssues.bookId,
      bookTitle: books.title,
      seriesId: reportedIssues.seriesId,
      seriesName: series.name,
      userId: reportedIssues.userId,
      userEmail: users.email,
    })
    .from(reportedIssues)
    .leftJoin(books, eq(reportedIssues.bookId, books.id))
    .leftJoin(users, eq(reportedIssues.userId, users.id))
    .leftJoin(series, eq(reportedIssues.seriesId, series.id))
    .where(eq(reportedIssues.status, activeStatus))
    .orderBy(desc(reportedIssues.createdAt))
    .limit(100);

  // Status counts for tab badges
  const statusRows = await db.all<{ status: string; count: number }>(sql`
    SELECT status, count(*) as count
    FROM reported_issues
    GROUP BY status
  `);

  const counts: Record<string, number> = {};
  for (const row of statusRows) {
    counts[row.status] = row.count;
  }

  return (
    <div className="space-y-6 lg:w-[60%] lg:mx-auto">
      <div>
        <h1
          className="text-foreground text-2xl font-bold tracking-tight"
         
        >
          Beta User Reports
        </h1>
        <p className="text-sm text-muted mt-1">
          Review user-reported issues and data quality problems
        </p>
      </div>

      <IssuesTriageDashboard
        issues={issues}
        counts={counts}
        activeStatus={activeStatus}
      />
    </div>
  );
}
