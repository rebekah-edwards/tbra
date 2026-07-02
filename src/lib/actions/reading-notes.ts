"use server";

import { db } from "@/db";
import { readingNotes, userBookState, buddyReadMessages, buddyReadMembers, buddyReads } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { addReadingNoteFor } from "@/lib/mutations/reading-notes";

const VALID_MOODS = ["excited", "tense", "emotional", "bored", "relaxed", "curious", "confused", "nostalgic"];
const VALID_PACES = ["slow", "steady", "fast", "flying"];

export async function addReadingNote(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  const bookId = formData.get("bookId") as string;
  const buddyReadId = formData.get("buddyReadId") as string | null;

  // Shared user-scoped implementation (also used by /api/v1) — see
  // src/lib/mutations/reading-notes.ts. Validation + writes are the exact
  // former body of this action.
  const result = await addReadingNoteFor(session.userId, {
    bookId,
    noteText: (formData.get("noteText") as string) ?? "",
    pageNumber: formData.get("pageNumber") ? parseInt(formData.get("pageNumber") as string) : null,
    percentComplete: formData.get("percentComplete") ? parseInt(formData.get("percentComplete") as string) : null,
    mood: formData.get("mood") as string | null,
    pace: formData.get("pace") as string | null,
    isPrivate: formData.get("isPrivate") !== "false",
    buddyReadId,
  });
  if (!result.success) return result;

  // Revalidate the buddy-read page if the note was shared there (the shared
  // mutation posts the message; only the cache invalidation lives here).
  if (buddyReadId) {
    try {
      const br = await db.select({ slug: buddyReads.slug }).from(buddyReads).where(eq(buddyReads.id, buddyReadId)).get();
      if (br?.slug) revalidatePath(`/buddy-reads/${br.slug}`);
    } catch {
      // cache revalidation is best-effort
    }
  }

  revalidatePath("/library");
  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

export async function toggleNotePrivacy(noteId: string): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  const note = await db
    .select({ id: readingNotes.id, bookId: readingNotes.bookId, isPrivate: readingNotes.isPrivate })
    .from(readingNotes)
    .where(and(eq(readingNotes.id, noteId), eq(readingNotes.userId, session.userId)))
    .get();

  if (!note) return { success: false, error: "Note not found" };

  await db.update(readingNotes)
    .set({ isPrivate: !note.isPrivate })
    .where(eq(readingNotes.id, noteId));

  revalidatePath("/library");
  revalidatePath(`/book/${note.bookId}`);
  revalidatePath("/profile/journal");
  return { success: true };
}

export async function deleteReadingNote(noteId: string): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  // Verify the note belongs to the user
  const note = await db
    .select({ id: readingNotes.id, bookId: readingNotes.bookId })
    .from(readingNotes)
    .where(and(eq(readingNotes.id, noteId), eq(readingNotes.userId, session.userId)))
    .get();

  if (!note) return { success: false, error: "Note not found" };

  await db.delete(readingNotes).where(eq(readingNotes.id, noteId));

  revalidatePath("/library");
  revalidatePath(`/book/${note.bookId}`);
  revalidatePath("/profile/journal");
  return { success: true };
}
