import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { books, readingNotes } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getUserBooks } from "@/lib/queries/reading-state";
import { getReadingGoal } from "@/lib/queries/reading-goals";
import { getReadingStreak } from "@/lib/queries/reading-streak";

/**
 * GET /api/v1/home
 * The signed-in user's home-page data: Reading Now (with latest progress %
 * and active buddy read), reading goal, and tbr streak. Mirrors the exact
 * queries + progress derivation of the web home page (src/app/page.tsx).
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const currentYear = new Date().getFullYear();

  const [allBooks, readingGoal, readingStreak] = await Promise.all([
    getUserBooks(user.userId),
    getReadingGoal(user.userId, currentYear),
    getReadingStreak(user.userId),
  ]);

  const currentlyReading = allBooks.filter((b) => b.state === "currently_reading");

  // Latest reading progress per currently-reading book (same logic as page.tsx)
  const progressMap = new Map<string, number>();
  if (currentlyReading.length > 0) {
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
            eq(readingNotes.userId, user.userId),
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
    const pagesMap = new Map(bookPages.map((b) => [b.id, b.pages]));

    // Take only the first (most recent) note per book
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

      if (pct != null && pct > 0) {
        progressMap.set(note.bookId, Math.min(pct, 100));
      }
    }
  }

  // Active buddy reads for currently-reading books
  const buddyReadMap = new Map<string, string>();
  if (currentlyReading.length > 0) {
    const crBookIds = currentlyReading.map((b) => b.id);
    const buddyReadRows = (await db.all(sql`
      SELECT br.id, br.book_id
      FROM buddy_reads br
      JOIN buddy_read_members brm ON brm.buddy_read_id = br.id
      WHERE br.status = 'active'
        AND brm.user_id = ${user.userId}
        AND brm.status = 'active'
        AND br.book_id IN (${sql.join(crBookIds.map((id) => sql`${id}`), sql`, `)})
    `)) as { id: string; book_id: string }[];
    for (const row of buddyReadRows) {
      buddyReadMap.set(row.book_id, row.id);
    }
  }

  const readingNow = currentlyReading.map((b) => ({
    id: b.id,
    slug: b.slug ?? null,
    title: b.title,
    coverImageUrl: b.coverImageUrl ?? null,
    authors: b.authors,
    pages: b.pages ?? null,
    activeFormats: b.activeFormats ?? [],
    progress: progressMap.get(b.id) ?? null,
    buddyReadId: buddyReadMap.get(b.id) ?? null,
  }));

  return jsonOk({
    year: currentYear,
    readingNow,
    goal: readingGoal, // { targetBooks, completedBooks, percentComplete } | null
    streak: { currentStreak: readingStreak.currentStreak, longestStreak: readingStreak.longestStreak },
  });
}
