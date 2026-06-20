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
  let force = false;
  try {
    const body = await request.json();
    bookId = body.bookId;
    // force: re-enrich even if the book already has ratings. Used by the
    // thin-ratings recovery campaign to refresh books whose ratings were
    // generated without working web research (all "no evidence found").
    force = body.force === true;
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

  // Idempotency: skip if already enriched. Content ratings are written last by the
  // Grok content-analysis step, so their presence is the canonical "enrichment
  // completed" signal — matching needsEnrichment in book/[id]/page.tsx.
  const existingRatings = await db
    .select({ id: bookCategoryRatings.id })
    .from(bookCategoryRatings)
    .where(eq(bookCategoryRatings.bookId, bookId))
    .limit(1)
    .all();

  if (existingRatings.length > 0 && !force) {
    return NextResponse.json({
      success: true,
      bookId,
      skipped: true,
      reason: "Already enriched",
    });
  }

  // Run enrichment — this is the long-running part.
  // skipBrave: false — this endpoint serves content-ratings backfill AND user
  // search-adds, the two paths where Brave web research most improves quality
  // (accurate ratings + metadata/cover fallback). Safe to enable now that
  // braveSearch enforces a hard daily/monthly budget cap. Bulk discovery import
  // (nightly-import.ts) keeps the skipBrave=true default so it doesn't compete
  // for the budget — those books get Brave later via the content-ratings pass.
  try {
    const outcome = await enrichBook(bookId, { skipBrave: false });
    // Don't report success on a no-op. enrichBook auto-pauses (returns "skipped")
    // when a hard API stop was logged in the last hour; reporting that as success
    // is exactly what masked the invalid-Brave-key outage. Surface it as 503 so
    // callers and manual re-triggers can tell nothing was enriched.
    if (outcome.status === "skipped") {
      return NextResponse.json(
        { success: false, bookId, skipped: true, reason: outcome.reason },
        { status: 503 },
      );
    }
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
