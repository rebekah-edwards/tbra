"use server";

import { db } from "@/db";
import { tbrNotes, userBookState } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getCurrentUser, hasPremiumAccess } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const MAX_NOTE_LENGTH = 500;

export async function saveTbrNote(
  bookId: string,
  noteText: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  if (!hasPremiumAccess(session)) {
    return { success: false, error: "Based Reader required" };
  }

  const trimmed = noteText.trim().slice(0, MAX_NOTE_LENGTH);
  if (!trimmed) return { success: false, error: "Note cannot be empty" };

  // Verify book is in TBR state
  const state = await db
    .select({ state: userBookState.state })
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, session.userId),
        eq(userBookState.bookId, bookId)
      )
    )
    .get();

  if (state?.state !== "tbr") {
    return { success: false, error: "Book must be on your TBR" };
  }

  try {
    // Upsert: insert or update
    const existing = await db
      .select({ id: tbrNotes.id })
      .from(tbrNotes)
      .where(
        and(
          eq(tbrNotes.userId, session.userId),
          eq(tbrNotes.bookId, bookId)
        )
      )
      .get();

    if (existing) {
      await db
        .update(tbrNotes)
        .set({ noteText: trimmed, updatedAt: sql`datetime('now')` })
        .where(eq(tbrNotes.id, existing.id));
    } else {
      await db.insert(tbrNotes).values({
        userId: session.userId,
        bookId,
        noteText: trimmed,
      });
    }
  } catch {
    return { success: false, error: "Notes not available yet" };
  }

  revalidatePath("/book/[id]", "page");
  revalidatePath("/library");
  return { success: true };
}

export async function deleteTbrNote(
  bookId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  try {
    await db
      .delete(tbrNotes)
      .where(
        and(
          eq(tbrNotes.userId, session.userId),
          eq(tbrNotes.bookId, bookId)
        )
      );
  } catch {
    return { success: false, error: "Notes not available yet" };
  }

  revalidatePath("/book/[id]", "page");
  revalidatePath("/library");
  return { success: true };
}
