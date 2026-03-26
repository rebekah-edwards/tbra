import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  reportCorrections,
  bookCategoryRatings,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/**
 * POST /api/admin/corrections/[id]/apply
 *
 * Accept a correction and write the proposed intensity/notes back
 * to the book's category rating (creates if absent, updates if present).
 * Marks the correction as "accepted".
 *
 * Optional body overrides:
 *   { intensityOverride?: number; notesOverride?: string }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let body: { intensityOverride?: number; notesOverride?: string } = {};
  try {
    body = await request.json();
  } catch {
    // no body is fine
  }

  // Fetch the correction
  const correction = await db.query.reportCorrections.findFirst({
    where: eq(reportCorrections.id, id),
  });

  if (!correction) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!correction.categoryId) {
    // No category — mark accepted but nothing to write to ratings
    await db
      .update(reportCorrections)
      .set({ status: "accepted" })
      .where(eq(reportCorrections.id, id));
    return NextResponse.json({ ok: true, note: "No category; status updated only." });
  }

  const intensity =
    body.intensityOverride ?? correction.proposedIntensity ?? null;
  const notes =
    body.notesOverride ?? correction.proposedNotes ?? null;

  if (intensity === null) {
    return NextResponse.json(
      { error: "No intensity to apply. Use intensityOverride in body." },
      { status: 400 }
    );
  }

  // Upsert the book category rating
  const existing = await db.query.bookCategoryRatings.findFirst({
    where: and(
      eq(bookCategoryRatings.bookId, correction.bookId),
      eq(bookCategoryRatings.categoryId, correction.categoryId)
    ),
  });

  const now = new Date().toISOString();

  if (existing) {
    await db
      .update(bookCategoryRatings)
      .set({
        intensity,
        notes: notes ?? existing.notes,
        evidenceLevel: "human_verified",
        updatedByUserId: user!.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookCategoryRatings.bookId, correction.bookId),
          eq(bookCategoryRatings.categoryId, correction.categoryId)
        )
      );
  } else {
    await db.insert(bookCategoryRatings).values({
      bookId: correction.bookId,
      categoryId: correction.categoryId,
      intensity,
      notes: notes ?? null,
      evidenceLevel: "human_verified",
      updatedByUserId: user!.userId,
      updatedAt: now,
    });
  }

  // Mark correction accepted
  await db
    .update(reportCorrections)
    .set({ status: "accepted" })
    .where(eq(reportCorrections.id, id));

  return NextResponse.json({ ok: true });
}
