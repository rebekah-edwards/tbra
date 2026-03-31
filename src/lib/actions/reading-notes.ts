"use server";

import { db } from "@/db";
import { readingNotes, userBookState } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const VALID_MOODS = ["excited", "tense", "emotional", "bored", "relaxed", "curious", "confused", "nostalgic"];
const VALID_PACES = ["slow", "steady", "fast", "flying"];

export async function addReadingNote(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  const bookId = formData.get("bookId") as string;
  const noteText = (formData.get("noteText") as string)?.trim();
  const pageNumber = formData.get("pageNumber") ? parseInt(formData.get("pageNumber") as string) : null;
  const percentComplete = formData.get("percentComplete") ? parseInt(formData.get("percentComplete") as string) : null;
  const mood = formData.get("mood") as string | null;
  const pace = formData.get("pace") as string | null;

  if (!bookId) return { success: false, error: "Book ID required" };
  if (!noteText) return { success: false, error: "Note text required" };
  if (noteText.length > 2000) return { success: false, error: "Note too long (max 2000 chars)" };

  // Validate the book is in currently_reading state
  const state = await db
    .select({ state: userBookState.state })
    .from(userBookState)
    .where(and(eq(userBookState.userId, session.userId), eq(userBookState.bookId, bookId)))
    .get();

  if (!state || state.state !== "currently_reading") {
    return { success: false, error: "Book must be in 'currently reading' state" };
  }

  // Validate optional fields
  if (pageNumber !== null && (pageNumber < 0 || pageNumber > 99999)) {
    return { success: false, error: "Invalid page number" };
  }
  if (percentComplete !== null && (percentComplete < 0 || percentComplete > 100)) {
    return { success: false, error: "Percentage must be 0-100" };
  }
  if (mood && !VALID_MOODS.includes(mood)) {
    return { success: false, error: "Invalid mood" };
  }
  if (pace && !VALID_PACES.includes(pace)) {
    return { success: false, error: "Invalid pace" };
  }

  const isPrivate = formData.get("isPrivate") !== "false"; // default true

  await db.insert(readingNotes).values({
    userId: session.userId,
    bookId,
    noteText,
    pageNumber,
    percentComplete,
    mood: mood || null,
    pace: pace || null,
    isPrivate,
  });

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
