import { NextResponse } from "next/server";
import { db } from "@/db";
import { books, bookCategoryRatings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import { getCurrentUser } from "@/lib/auth";

// Give enrichment plenty of time to complete on Vercel Pro
export const maxDuration = 120;

/**
 * POST /api/enrichment/trigger
 *
 * Enrich a single book by ID. This endpoint awaits enrichBook() to
 * completion, keeping the serverless function alive for the full
 * duration. Designed to be called from next/server after() callbacks
 * or from the client side.
 *
 * Body: { bookId: string }
 */
export async function POST(request: Request) {
  // Auth: accept localhost, enrichment secret, OR admin session
  const host = request.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const secret = request.headers.get("x-enrichment-secret");
  const isSecretAuthed = secret === process.env.ENRICHMENT_SECRET;

  let isAdminAuthed = false;
  if (!isSecretAuthed) {
    const user = await getCurrentUser();
    isAdminAuthed = !!(user && user.role === "admin");
  }

  if (!isLocalhost && !isSecretAuthed && !isAdminAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let bookId: string;
  try {
    const body = await request.json();
    bookId = body.bookId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!bookId || typeof bookId !== "string") {
    return NextResponse.json({ error: "bookId is required" }, { status: 400 });
  }

  // Check pause flag
  if (process.env.ENRICHMENT_PAUSED === "true") {
    return NextResponse.json({ paused: true }, { status: 503 });
  }

  // Verify the book exists
  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
    columns: { id: true, title: true },
  });
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // Idempotency: skip if already enriched (has category ratings)
  const existingRatings = await db
    .select({ id: bookCategoryRatings.id })
    .from(bookCategoryRatings)
    .where(eq(bookCategoryRatings.bookId, bookId))
    .limit(1)
    .all();

  if (existingRatings.length > 0) {
    return NextResponse.json({
      success: true,
      bookId,
      skipped: true,
      reason: "Already enriched",
    });
  }

  // Run enrichment — this is the long-running part
  try {
    await enrichBook(bookId);
    return NextResponse.json({ success: true, bookId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[trigger] Enrichment failed for "${book.title}" (${bookId}):`, message);
    return NextResponse.json(
      { success: false, bookId, error: message },
      { status: 500 },
    );
  }
}
