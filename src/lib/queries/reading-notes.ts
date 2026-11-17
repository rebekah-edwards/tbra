import { db } from "@/db";
import { readingNotes, books } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

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

export interface SharedNote {
  id: string;
  bookId: string;
  bookSlug: string | null;
  bookTitle: string;
  bookCoverUrl: string | null;
  noteText: string;
  pageNumber: number | null;
  percentComplete: number | null;
  createdAt: string;
}

/**
 * A reader's notes that THEY marked shared ("Visible to friends"), newest
 * first — for their profile. Private notes are excluded in the query itself;
 * callers still decide who may see the result (the owner and their followers).
 */
export async function getSharedNotes(userId: string, limit = 10): Promise<SharedNote[]> {
  return db
    .select({
      id: readingNotes.id,
      bookId: readingNotes.bookId,
      bookSlug: books.slug,
      bookTitle: books.title,
      bookCoverUrl: books.coverImageUrl,
      noteText: readingNotes.noteText,
      pageNumber: readingNotes.pageNumber,
      percentComplete: readingNotes.percentComplete,
      createdAt: readingNotes.createdAt,
    })
    .from(readingNotes)
    .innerJoin(books, eq(readingNotes.bookId, books.id))
    .where(and(
      eq(readingNotes.userId, userId),
      eq(readingNotes.isPrivate, false),
      sql`TRIM(${readingNotes.noteText}) != ''`,
    ))
    .orderBy(desc(readingNotes.createdAt))
    .limit(limit);
}
