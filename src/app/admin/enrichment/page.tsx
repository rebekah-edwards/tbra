import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { books, bookCategoryRatings, enrichmentLog, bookAuthors, authors } from "@/db/schema";
import { eq, sql, desc, isNull } from "drizzle-orm";
import { EnrichmentDashboardClient } from "@/components/admin/enrichment-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminEnrichmentPage() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  // Books with failed enrichment that still have no category ratings (not yet fixed)
  const failedBooks = await db.all(sql`
    SELECT
      b.id,
      b.title,
      b.cover_image_url as coverImageUrl,
      b.created_at as createdAt,
      el.status,
      el.error_message as errorMessage,
      el.created_at as failedAt
    FROM ${enrichmentLog} el
    JOIN ${books} b ON b.id = el.book_id
    LEFT JOIN ${bookCategoryRatings} bcr ON bcr.book_id = b.id
    WHERE el.status IN ('failed', 'api_exhausted')
    AND bcr.id IS NULL
    ORDER BY el.created_at DESC
    LIMIT 100
  `) as Array<{
    id: string;
    title: string;
    coverImageUrl: string | null;
    createdAt: string;
    status: string;
    errorMessage: string | null;
    failedAt: string;
  }>;

  // Books that were never enriched (no category ratings AND no summary)
  const neverEnriched = await db.all(sql`
    SELECT
      b.id,
      b.title,
      b.cover_image_url as coverImageUrl,
      b.created_at as createdAt
    FROM ${books} b
    LEFT JOIN ${bookCategoryRatings} bcr ON bcr.book_id = b.id
    WHERE bcr.id IS NULL
    AND b.summary IS NULL
    AND b.visibility != 'import_only'
    ORDER BY b.created_at DESC
    LIMIT 100
  `) as Array<{
    id: string;
    title: string;
    coverImageUrl: string | null;
    createdAt: string;
  }>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1
        className="text-foreground text-2xl font-bold tracking-tight mb-6"
       
      >
        Enrichment Dashboard
      </h1>

      <EnrichmentDashboardClient
        failedBooks={failedBooks}
        neverEnriched={neverEnriched}
      />
    </div>
  );
}
