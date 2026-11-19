import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  reportCorrections,
  bookCategoryRatings,
  books,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isAdmin } from "@/lib/auth";

const MAX_NOTES_LENGTH = 1000;

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

  // The admin editor sends both overrides ("Save & Verify"); reject anything
  // that isn't a whole 0-4 strength or a non-empty note.
  if (
    body.intensityOverride !== undefined &&
    !(Number.isInteger(body.intensityOverride) &&
      body.intensityOverride >= 0 &&
      body.intensityOverride <= 4)
  ) {
    return NextResponse.json({ error: "Strength must be a whole number from 0 to 4." }, { status: 400 });
  }
  if (body.notesOverride !== undefined) {
    if (typeof body.notesOverride !== "string") {
      return NextResponse.json({ error: "Notes must be text." }, { status: 400 });
    }
    body.notesOverride = body.notesOverride.trim();
    if (!body.notesOverride) {
      return NextResponse.json({ error: "Notes can't be empty." }, { status: 400 });
    }
    if (body.notesOverride.length > MAX_NOTES_LENGTH) {
      return NextResponse.json({ error: `Notes must be under ${MAX_NOTES_LENGTH} characters.` }, { status: 400 });
    }
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

  // Book pages are ISR (60s); show the verified rating right away.
  const book = await db
    .select({ slug: books.slug })
    .from(books)
    .where(eq(books.id, correction.bookId))
    .get();
  if (book?.slug) revalidatePath(`/book/${book.slug}`);
  revalidatePath("/admin/corrections");

  return NextResponse.json({ ok: true });
}
