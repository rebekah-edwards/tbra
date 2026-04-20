import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { userBookReviews, books } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notifyReviewerOfArcDecision } from "@/lib/notifications/arc";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const review = await db
    .select({
      userId: userBookReviews.userId,
      bookId: userBookReviews.bookId,
      bookTitle: books.title,
      bookSlug: books.slug,
    })
    .from(userBookReviews)
    .leftJoin(books, eq(books.id, userBookReviews.bookId))
    .where(eq(userBookReviews.id, id))
    .get();

  await db
    .update(userBookReviews)
    .set({ arcStatus: "rejected", updatedAt: new Date().toISOString() })
    .where(eq(userBookReviews.id, id));

  if (review) {
    await notifyReviewerOfArcDecision({
      reviewerId: review.userId,
      bookId: review.bookId,
      bookTitle: review.bookTitle ?? "your book",
      bookSlug: review.bookSlug ?? null,
      approved: false,
    });
  }

  return NextResponse.json({ success: true });
}
