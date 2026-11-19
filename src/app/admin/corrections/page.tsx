import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { reportCorrections, books, users, taxonomyCategories, bookCategoryRatings } from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { CorrectionsTriageDashboard } from "@/components/admin/corrections-triage";

export const dynamic = "force-dynamic";

export default async function AdminCorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  const { status: statusParam } = await searchParams;
  const activeStatus = statusParam ?? "new";

  // Fetch corrections with joins
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
      bookSlug: books.slug,
      userId: reportCorrections.userId,
      userEmail: users.email,
      categoryId: reportCorrections.categoryId,
      categoryName: taxonomyCategories.name,
      categoryKey: taxonomyCategories.key,
      // The rating entry this edit proposes to change (null if the book has
      // no rating in that category yet).
      currentIntensity: bookCategoryRatings.intensity,
      currentNotes: bookCategoryRatings.notes,
      currentEvidence: bookCategoryRatings.evidenceLevel,
    })
    .from(reportCorrections)
    .leftJoin(books, eq(reportCorrections.bookId, books.id))
    .leftJoin(users, eq(reportCorrections.userId, users.id))
    .leftJoin(taxonomyCategories, eq(reportCorrections.categoryId, taxonomyCategories.id))
    .leftJoin(
      bookCategoryRatings,
      and(
        eq(bookCategoryRatings.bookId, reportCorrections.bookId),
        eq(bookCategoryRatings.categoryId, reportCorrections.categoryId),
      ),
    )
    .where(eq(reportCorrections.status, activeStatus))
    .orderBy(desc(reportCorrections.createdAt))
    .limit(100);

  // Status counts for tab badges
  const statusRows = await db.all<{ status: string; count: number }>(sql`
    SELECT status, count(*) as count
    FROM report_corrections
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
          Proposed Edits
        </h1>
        <p className="text-sm text-muted mt-1">
          Compare each reader&apos;s suggestion with the current entry, edit
          the wording and strength, then Save &amp; Verify.
        </p>
      </div>

      <CorrectionsTriageDashboard
        corrections={corrections}
        counts={counts}
        activeStatus={activeStatus}
      />
    </div>
  );
}
