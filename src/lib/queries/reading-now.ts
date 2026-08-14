import { db } from "@/db";
import { books, readingNotes } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getUserBooks } from "@/lib/queries/reading-state";

/**
 * The "Reading Now" list with per-book progress and active buddy read.
 *
 * Extracted from /api/v1/home so the widget endpoint can serve the exact same
 * shape — two copies of this progress derivation would drift the moment one
 * of them learned about a new progress source.
 */
export interface ReadingNowBook {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  usesAudiobookCover: boolean;
  authors: string[];
  pages: number | null;
  audioLengthMinutes: number | null;
  activeFormats: string[];
  /** 0-100 from the most recent reading note, or null when never logged. */
  progress: number | null;
  buddyReadId: string | null;
}

export async function getReadingNow(userId: string): Promise<ReadingNowBook[]> {
  const allBooks = await getUserBooks(userId);
  const currentlyReading = allBooks.filter((b) => b.state === "currently_reading");
  if (currentlyReading.length === 0) return [];

  const crBookIds = currentlyReading.map((b) => b.id);

  const [latestNotes, bookPages] = await Promise.all([
    db
      .select({
        bookId: readingNotes.bookId,
        pageNumber: readingNotes.pageNumber,
        percentComplete: readingNotes.percentComplete,
      })
      .from(readingNotes)
      .where(
        and(
          eq(readingNotes.userId, userId),
          inArray(readingNotes.bookId, crBookIds),
          sql`(${readingNotes.pageNumber} IS NOT NULL OR ${readingNotes.percentComplete} IS NOT NULL)`
        )
      )
      .orderBy(desc(readingNotes.createdAt))
      .all(),
    db
      .select({ id: books.id, pages: books.pages })
      .from(books)
      .where(inArray(books.id, crBookIds))
      .all(),
  ]);
  // Explicit types: drizzle's .all() widens these rows to `any` here, which
  // silently propagated `{}` into the arithmetic below.
  const pagesMap = new Map<string, number | null>(
    (bookPages as { id: string; pages: number | null }[]).map((b) => [b.id, b.pages])
  );

  // First row per book wins — the query is already newest-first.
  const progressMap = new Map<string, number>();
  const seen = new Set<string>();
  for (const note of latestNotes) {
    if (seen.has(note.bookId)) continue;
    seen.add(note.bookId);

    let pct: number | null = null;
    if (note.percentComplete != null && note.percentComplete > 0) {
      pct = note.percentComplete;
    } else if (note.pageNumber != null && note.pageNumber > 0) {
      const totalPages = pagesMap.get(note.bookId);
      if (totalPages && totalPages > 0) {
        pct = Math.round((note.pageNumber / totalPages) * 100);
      }
    }
    if (pct != null && pct > 0) progressMap.set(note.bookId, Math.min(pct, 100));
  }

  const buddyReadMap = new Map<string, string>();
  const buddyReadRows = (await db.all(sql`
    SELECT br.id, br.book_id
    FROM buddy_reads br
    JOIN buddy_read_members brm ON brm.buddy_read_id = br.id
    WHERE br.status = 'active'
      AND brm.user_id = ${userId}
      AND brm.status = 'active'
      AND br.book_id IN (${sql.join(crBookIds.map((id) => sql`${id}`), sql`, `)})
  `)) as { id: string; book_id: string }[];
  for (const row of buddyReadRows) buddyReadMap.set(row.book_id, row.id);

  return currentlyReading.map((b) => ({
    id: b.id,
    slug: b.slug ?? null,
    title: b.title,
    coverImageUrl: b.coverImageUrl ?? null,
    usesAudiobookCover: b.usesAudiobookCover,
    authors: b.authors,
    pages: b.pages ?? null,
    audioLengthMinutes: b.audioLengthMinutes ?? null,
    activeFormats: b.activeFormats ?? [],
    progress: progressMap.get(b.id) ?? null,
    buddyReadId: buddyReadMap.get(b.id) ?? null,
  }));
}
