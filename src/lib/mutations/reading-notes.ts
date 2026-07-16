import { db } from "@/db";
import { readingNotes, userBookState, buddyReadMessages, buddyReadMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";

const VALID_MOODS = ["excited", "tense", "emotional", "bored", "relaxed", "curious", "confused", "nostalgic"];
const VALID_PACES = ["slow", "steady", "fast", "flying"];

export interface AddReadingNoteInput {
  bookId: string;
  noteText: string;
  pageNumber?: number | null;
  percentComplete?: number | null;
  mood?: string | null;
  pace?: string | null;
  isPrivate?: boolean; // default true, matching the web
  buddyReadId?: string | null;
}

/**
 * User-scoped core of the addReadingNote server action — identical validation
 * and writes, shared by the web action and /api/v1/reading-notes.
 */
export async function addReadingNoteFor(
  userId: string,
  input: AddReadingNoteInput
): Promise<{ success: boolean; error?: string }> {
  const { bookId, mood, pace, buddyReadId } = input;
  const noteText = input.noteText?.trim();
  const pageNumber = input.pageNumber ?? null;
  const percentComplete = input.percentComplete ?? null;

  if (!bookId) return { success: false, error: "Book ID required" };
  if (!noteText) return { success: false, error: "Note text required" };
  if (noteText.length > 2000) return { success: false, error: "Note too long (max 2000 chars)" };

  // Validate the book is in currently_reading state
  const state = await db
    .select({ state: userBookState.state })
    .from(userBookState)
    .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, bookId)))
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

  const isPrivate = input.isPrivate !== false; // default true

  await db.insert(readingNotes).values({
    userId,
    bookId,
    noteText,
    pageNumber,
    percentComplete,
    mood: mood || null,
    pace: pace || null,
    isPrivate,
  });

  // Optionally share to buddy read discussion
  if (buddyReadId) {
    try {
      // Verify user is an active member
      const membership = await db
        .select({ status: buddyReadMembers.status })
        .from(buddyReadMembers)
        .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, userId)))
        .get();
      if (membership?.status === "active") {
        const parts: string[] = [];
        if (pageNumber) parts.push(`p.${pageNumber}`);
        if (percentComplete !== null) parts.push(`${percentComplete}%`);
        const progressInfo = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        const message = `📖 Reading update${progressInfo}: ${noteText}`;
        await db.insert(buddyReadMessages).values({
          buddyReadId,
          userId,
          message: message.slice(0, 2000),
        });
      }
    } catch {
      // Don't fail the note creation if buddy read sharing fails
    }
  }

  return { success: true };
}
