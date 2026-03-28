import { db } from "@/db";
import { readingNotes, books } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export interface ReadingNote {
  id: string;
  bookId: string;
  noteText: string;
  pageNumber: number | null;
  percentComplete: number | null;
  mood: string | null;
  pace: string | null;
  isPrivate: boolean;
  createdAt: string;
}

export interface ReadingNoteWithBook extends ReadingNote {
  bookTitle: string;
  bookCoverUrl: string | null;
}

export async function getBookReadingNotes(
  userId: string,
  bookId: string,
  limit = 20
): Promise<ReadingNote[]> {
  return db
    .select({
      id: readingNotes.id,
      bookId: readingNotes.bookId,
      noteText: readingNotes.noteText,
      pageNumber: readingNotes.pageNumber,
      percentComplete: readingNotes.percentComplete,
      mood: readingNotes.mood,
      pace: readingNotes.pace,
      isPrivate: readingNotes.isPrivate,
      createdAt: readingNotes.createdAt,
    })
    .from(readingNotes)
    .where(and(eq(readingNotes.userId, userId), eq(readingNotes.bookId, bookId)))
    .orderBy(desc(readingNotes.createdAt))
    .limit(limit);
}

export async function getRecentNotes(
  userId: string,
  limit = 5
): Promise<ReadingNoteWithBook[]> {
  const rows = await db
    .select({
      id: readingNotes.id,
      bookId: readingNotes.bookId,
      noteText: readingNotes.noteText,
      pageNumber: readingNotes.pageNumber,
      percentComplete: readingNotes.percentComplete,
      mood: readingNotes.mood,
      pace: readingNotes.pace,
      isPrivate: readingNotes.isPrivate,
      createdAt: readingNotes.createdAt,
      bookTitle: books.title,
      bookSlug: books.slug,
      bookCoverUrl: books.coverImageUrl,
    })
    .from(readingNotes)
    .innerJoin(books, eq(readingNotes.bookId, books.id))
    .where(eq(readingNotes.userId, userId))
    .orderBy(desc(readingNotes.createdAt))
    .limit(limit);

  return rows;
}
