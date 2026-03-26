import { NextResponse } from "next/server";
import { db } from "@/db";
import { books } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/**
 * PATCH /api/admin/review
 *
 * Update a flagged book's missing fields and optionally clear the review flag.
 * Body: { bookId, updates: { publicationYear?, pages?, description? }, markReviewed?: boolean }
 */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { bookId, updates, markReviewed } = body as {
    bookId: string;
    updates?: {
      publicationYear?: number;
      pages?: number;
      description?: string;
    };
    markReviewed?: boolean;
  };

  if (!bookId) {
    return NextResponse.json({ error: "Missing bookId" }, { status: 400 });
  }

  const setFields: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (updates?.publicationYear) setFields.publicationYear = updates.publicationYear;
  if (updates?.pages) setFields.pages = updates.pages;
  if (updates?.description) setFields.description = updates.description;

  if (markReviewed) {
    setFields.needsReview = false;
    setFields.reviewReason = null;
  }

  await db.update(books).set(setFields).where(eq(books.id, bookId));

  return NextResponse.json({ ok: true });
}
