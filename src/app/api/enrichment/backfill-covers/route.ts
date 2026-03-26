import { NextResponse } from "next/server";
import { db } from "@/db";
import { books } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { findIsbnCover, findEnglishCover, buildCoverUrl } from "@/lib/openlibrary";
import { getCurrentUser } from "@/lib/auth";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/enrichment/backfill-covers
 *
 * Lightweight cover backfill using free Open Library sources only.
 * No Brave/Grok/Google Books API calls — just OL ISBN covers and edition lookups.
 *
 * Strategy:
 *   Tier A: OL ISBN cover endpoint (instant HEAD check)
 *   Tier B: Re-run findEnglishCover(workKey) for books with OL keys
 *
 * Query params:
 *   limit — max books per batch (default 100, max 500)
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
  const limit = Math.min(500, parseInt(searchParams.get("limit") ?? "100", 10));

  // Get books missing covers, library first
  const missing = await db.all(sql`
    SELECT b.id, b.title, b.isbn_13, b.isbn_10, b.open_library_key,
      CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
    FROM books b
    WHERE b.cover_image_url IS NULL
    ORDER BY priority ASC, b.created_at DESC
    LIMIT ${limit}
  `) as { id: string; title: string; isbn_13: string | null; isbn_10: string | null; open_library_key: string | null; priority: number }[];

  if (missing.length === 0) {
    return NextResponse.json({ message: "All books have covers", processed: 0 });
  }

  let foundCovers = 0;
  let triedIsbn = 0;
  let triedEditions = 0;
  const stillMissing: string[] = [];

  for (const book of missing) {
    let coverUrl: string | null = null;

    // Tier A: Try ISBN cover
    if (book.isbn_13) {
      triedIsbn++;
      coverUrl = await findIsbnCover(book.isbn_13);
    }
    if (!coverUrl && book.isbn_10) {
      triedIsbn++;
      coverUrl = await findIsbnCover(book.isbn_10);
    }

    // Tier B: Try OL edition cover lookup
    if (!coverUrl && book.open_library_key) {
      triedEditions++;
      try {
        const { coverId } = await findEnglishCover(book.open_library_key);
        if (coverId) {
          coverUrl = buildCoverUrl(coverId, "L");
        }
      } catch {
        // OL API error — skip
      }
    }

    if (coverUrl) {
      await db.update(books).set({ coverImageUrl: coverUrl, updatedAt: new Date().toISOString() }).where(eq(books.id, book.id));
      foundCovers++;
      console.log(`[backfill-covers] ✓ ${book.title}`);
    } else {
      stillMissing.push(book.title);
    }

    // Rate limit OL calls
    await delay(300);
  }

  // Count remaining
  const remainingRows = await db.all(sql`
    SELECT COUNT(*) as count FROM books WHERE cover_image_url IS NULL
  `) as { count: number }[];

  return NextResponse.json({
    processed: missing.length,
    foundCovers,
    triedIsbn,
    triedEditions,
    stillMissing: stillMissing.length,
    stillMissingTitles: stillMissing.slice(0, 30),
    totalRemaining: remainingRows[0]?.count ?? 0,
  });
}
