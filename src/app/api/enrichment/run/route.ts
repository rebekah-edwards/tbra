import { NextResponse } from "next/server";
import { db } from "@/db";
import { books, bookCategoryRatings } from "@/db/schema";
import { sql } from "drizzle-orm";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import { getCurrentUser } from "@/lib/auth";

const DELAY_MS = 1500;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/enrichment/run
 *
 * Trigger enrichment for a batch of books. Runs up to `limit` books
 * (default 10) that need enrichment. Stops on API exhaustion.
 *
 * Query params:
 *   limit — max books to process (default 10)
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
  const limit = Math.min(50, parseInt(searchParams.get("limit") ?? "10", 10));
  const skipGoogleBooks = searchParams.get("skipGoogleBooks") === "true";
  const force = searchParams.get("force") === "true";

  // Global pause: set ENRICHMENT_PAUSED=true in .env.local to halt all enrichment
  if (process.env.ENRICHMENT_PAUSED === "true" && !force) {
    return NextResponse.json({
      message: "Enrichment is paused. Set ENRICHMENT_PAUSED=false in .env.local or use force=true to override.",
      paused: true,
      processed: 0,
      success: 0,
      failed: 0,
    }, { status: 503 });
  }

  // Refuse to run if API was exhausted in the last hour (unless force=true)
  if (!force) {
    const recentExhaustion = await db.all(sql`
      SELECT count(*) as count FROM enrichment_log
      WHERE status = 'api_exhausted'
      AND created_at > datetime('now', '-1 hour')
    `) as { count: number }[];
    if (recentExhaustion[0]?.count > 0) {
      return NextResponse.json({
        message: "API was exhausted recently. Wait for credits to reset or use force=true to override.",
        apiExhausted: true,
        processed: 0,
        success: 0,
        failed: 0,
      }, { status: 429 });
    }
  }

  const needsEnrichment = await db.all(sql`
    SELECT DISTINCT b.id, b.title,
      CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
    FROM books b
    LEFT JOIN book_category_ratings bcr ON bcr.book_id = b.id
    WHERE b.summary IS NULL
    AND bcr.id IS NULL
    AND (b.language IS NULL OR b.language = '' OR b.language = 'English')
    AND b.is_box_set = 0
    ORDER BY priority ASC, b.created_at DESC
    LIMIT ${limit}
  `) as { id: string; title: string }[];

  if (needsEnrichment.length === 0) {
    return NextResponse.json({ message: "All books enriched", processed: 0 });
  }

  let success = 0;
  let failed = 0;
  let exhausted = false;
  const errors: { title: string; error: string }[] = [];
  const skippedGoogleBooks: string[] = [];

  for (const book of needsEnrichment) {
    try {
      await enrichBook(book.id, { skipGoogleBooks });
      success++;
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === "API_EXHAUSTED") {
        exhausted = true;
        errors.push({ title: book.title, error: msg });
        break;
      }
      failed++;
      errors.push({ title: book.title, error: msg });
    }
    await delay(DELAY_MS);
  }

  return NextResponse.json({
    processed: success + failed,
    success,
    failed,
    apiExhausted: exhausted,
    errors,
    remaining: needsEnrichment.length - success - failed - (exhausted ? 1 : 0),
    ...(skipGoogleBooks ? { skippedGoogleBooks: true } : {}),
  });
}
