import { db } from "@/db";
import { tbrNotes } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export async function getTbrNote(
  userId: string,
  bookId: string
): Promise<string | null> {
  try {
    const row = await db
      .select({ noteText: tbrNotes.noteText })
      .from(tbrNotes)
      .where(
        and(
          eq(tbrNotes.userId, userId),
          eq(tbrNotes.bookId, bookId)
        )
      )
      .get();

    return row?.noteText ?? null;
  } catch {
    // Table may not exist on Turso yet
    return null;
  }
}

export async function getTbrNotesForBooks(
  userId: string,
  bookIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (bookIds.length === 0) return map;

  try {
    const rows = await db
      .select({ bookId: tbrNotes.bookId, noteText: tbrNotes.noteText })
      .from(tbrNotes)
      .where(
        and(
          eq(tbrNotes.userId, userId),
          inArray(tbrNotes.bookId, bookIds)
        )
      )
      .all();

    for (const row of rows) {
      map.set(row.bookId, row.noteText);
    }
  } catch {
    // Table may not exist on Turso yet
  }

  return map;
}
