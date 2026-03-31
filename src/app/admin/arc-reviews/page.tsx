import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { userBookReviews, books, users } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { ArcReviewQueue } from "./arc-review-queue";

export const dynamic = "force-dynamic";

export default async function AdminArcReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  const { status: statusParam } = await searchParams;
  const activeStatus = statusParam ?? "pending";

  const reviews = await db
    .select({
      id: userBookReviews.id,
      userId: userBookReviews.userId,
      bookId: userBookReviews.bookId,
      overallRating: userBookReviews.overallRating,
      reviewText: userBookReviews.reviewText,
      arcSource: userBookReviews.arcSource,
      arcSourceDetail: userBookReviews.arcSourceDetail,
      arcProofUrl: userBookReviews.arcProofUrl,
      arcStatus: userBookReviews.arcStatus,
      createdAt: userBookReviews.createdAt,
      bookTitle: books.title,
      bookSlug: books.slug,
      userDisplayName: users.displayName,
      userUsername: users.username,
      userEmail: users.email,
    })
    .from(userBookReviews)
    .innerJoin(books, eq(userBookReviews.bookId, books.id))
    .innerJoin(users, eq(userBookReviews.userId, users.id))
    .where(eq(userBookReviews.arcStatus, activeStatus))
    .orderBy(desc(userBookReviews.createdAt))
    .limit(100);

  const statusRows = await db.all<{ status: string; count: number }>(sql`
    SELECT arc_status as status, count(*) as count
    FROM user_book_reviews
    WHERE arc_status IS NOT NULL
    GROUP BY arc_status
  `);
  const statusCounts: Record<string, number> = {};
  for (const row of statusRows) {
    statusCounts[row.status] = row.count;
  }

  return (
    <div className="mx-auto lg:max-w-[60%]">
      <h1 className="text-2xl font-bold text-foreground mb-6">ARC Reviews</h1>
      <ArcReviewQueue
        reviews={reviews}
        statusCounts={statusCounts}
        activeStatus={activeStatus}
      />
    </div>
  );
}
