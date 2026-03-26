import { NextResponse } from "next/server";
import { db } from "@/db";
import { books } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { isEnglishTitle } from "@/lib/queries/books";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/enrichment/backfill-language
 *
 * Fast heuristic-based language backfill for books that already have enrichment
 * data but are missing the language field. Uses isEnglishTitle() to tag obvious
 * English titles immediately without burning API calls.
 *
 * Books that fail the heuristic (likely non-English) are flagged but NOT
 * auto-tagged — they'll get picked up by the re-enrichment loop for proper
 * language detection via the AI.
 *
 * Query params:
 *   limit — max books to process per batch (default 500, max 5000)
 */
export async function POST(request: Request) {
  const host = request.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const user = await getCurrentUser();
  const localSecret = request.headers.get("x-enrichment-secret");
  const isLocalAuthed = localSecret === process.env.ENRICHMENT_SECRET;

  if (!isLocalhost && !isLocalAuthed && (!user || user.role !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(5000, parseInt(searchParams.get("limit") ?? "500", 10));

  // Get books missing language, library first
  const missing = await db.all(sql`
    SELECT b.id, b.title,
      CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
    FROM books b
    WHERE b.language IS NULL
    ORDER BY priority ASC, b.created_at DESC
    LIMIT ${limit}
  `) as { id: string; title: string; priority: number }[];

  if (missing.length === 0) {
    return NextResponse.json({ message: "All books have language set", processed: 0 });
  }

  let taggedEnglish = 0;
  let flaggedNonEnglish = 0;
  const nonEnglishTitles: string[] = [];

  for (const book of missing) {
    if (isEnglishTitle(book.title)) {
      await db.update(books).set({ language: "English" }).where(eq(books.id, book.id));
      taggedEnglish++;
    } else {
      // Don't auto-tag — let re-enrichment detect the actual language
      flaggedNonEnglish++;
      nonEnglishTitles.push(book.title);
    }
  }

  // Count remaining
  const remainingRows = await db.all(sql`
    SELECT COUNT(*) as count FROM books WHERE language IS NULL
  `) as { count: number }[];

  return NextResponse.json({
    processed: missing.length,
    taggedEnglish,
    flaggedNonEnglish,
    nonEnglishTitles: nonEnglishTitles.slice(0, 50), // Show first 50 for review
    remaining: remainingRows[0]?.count ?? 0,
  });
}
