import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { enrichBook } from "@/lib/enrichment/enrich-book";
import { getCurrentUser } from "@/lib/auth";

const DELAY_MS = 1500;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/enrichment/re-enrich
 *
 * Re-enrich books that already have data but need quality improvements:
 *   - Over-length summaries (>190 chars)
 *   - Missing covers
 *   - Missing content ratings (partially enriched)
 *   - Missing language detection
 *   - Missing descriptions
 *   - Missing audiobook lengths
 *
 * Query params:
 *   limit — max books to process (default 10, max 50)
 *   focus — "summary" | "cover" | "cover-only" | "language" | "description" | "audio" | "all" (default "all")
 *
 * Focus modes that skip Grok: "cover-only" (Tiers A-C only), "audio" (Brave only)
 * Focus modes that use Grok: "summary", "cover", "description", "language", "all"
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
  const focus = searchParams.get("focus") ?? "all";
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

  let querySQL;
  // Map API focus to enrichBook focus option
  let enrichFocus: "full" | "cover" | "audio" | "description" | undefined;

  if (focus === "summary") {
    querySQL = sql`
      SELECT b.id, b.title, LENGTH(b.summary) as summary_len,
        CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
      FROM books b
      WHERE (b.summary IS NULL OR LENGTH(b.summary) > 190)
      AND EXISTS (SELECT 1 FROM book_category_ratings bcr WHERE bcr.book_id = b.id)
      ORDER BY priority ASC, b.created_at DESC
      LIMIT ${limit}
    `;
  } else if (focus === "cover") {
    // Full enrichment for books missing covers (includes Grok for all data)
    querySQL = sql`
      SELECT b.id, b.title, NULL as summary_len,
        CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
      FROM books b
      WHERE b.cover_image_url IS NULL
      ORDER BY priority ASC, b.created_at DESC
      LIMIT ${limit}
    `;
  } else if (focus === "cover-only") {
    // Cover cascade ONLY — no Brave search, no Grok (fast, free-ish)
    enrichFocus = "cover";
    querySQL = sql`
      SELECT b.id, b.title, NULL as summary_len,
        CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
      FROM books b
      WHERE b.cover_image_url IS NULL
      ORDER BY priority ASC, b.created_at DESC
      LIMIT ${limit}
    `;
  } else if (focus === "language") {
    querySQL = sql`
      SELECT b.id, b.title, NULL as summary_len,
        CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
      FROM books b
      WHERE b.language IS NULL
      ORDER BY priority ASC, b.created_at DESC
      LIMIT ${limit}
    `;
  } else if (focus === "description") {
    enrichFocus = "description";
    querySQL = sql`
      SELECT b.id, b.title, NULL as summary_len,
        CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
      FROM books b
      WHERE b.description IS NULL
      ORDER BY priority ASC, b.created_at DESC
      LIMIT ${limit}
    `;
  } else if (focus === "audio") {
    enrichFocus = "audio";
    querySQL = sql`
      SELECT b.id, b.title, NULL as summary_len,
        CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
      FROM books b
      WHERE b.audio_length_minutes IS NULL
      ORDER BY priority ASC, b.created_at DESC
      LIMIT ${limit}
    `;
  } else {
    // All quality issues — library first
    querySQL = sql`
      SELECT DISTINCT b.id, b.title, LENGTH(b.summary) as summary_len,
        CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END as priority
      FROM books b
      LEFT JOIN book_category_ratings bcr ON bcr.book_id = b.id
      WHERE b.summary IS NULL
         OR LENGTH(b.summary) > 190
         OR b.cover_image_url IS NULL
         OR bcr.id IS NULL
         OR b.language IS NULL
         OR b.description IS NULL
         OR b.audio_length_minutes IS NULL
      ORDER BY priority ASC, b.created_at DESC
      LIMIT ${limit}
    `;
  }

  const needsWork = await db.all(querySQL) as {
    id: string;
    title: string;
    summary_len: number | null;
  }[];

  if (needsWork.length === 0) {
    const remaining = await db.all(sql`
      SELECT
        (SELECT COUNT(*) FROM books WHERE summary IS NOT NULL AND LENGTH(summary) > 190) as long_summaries,
        (SELECT COUNT(*) FROM books WHERE cover_image_url IS NULL) as missing_covers,
        (SELECT COUNT(*) FROM books b WHERE NOT EXISTS (SELECT 1 FROM book_category_ratings bcr WHERE bcr.book_id = b.id)) as no_ratings,
        (SELECT COUNT(*) FROM books WHERE language IS NULL) as missing_language,
        (SELECT COUNT(*) FROM books WHERE description IS NULL) as missing_descriptions,
        (SELECT COUNT(*) FROM books WHERE audio_length_minutes IS NULL) as missing_audio
    `) as Record<string, number>[];

    return NextResponse.json({
      message: "No books need re-enrichment",
      processed: 0,
      issues: remaining[0] ?? {},
    });
  }

  let success = 0;
  let failed = 0;
  let exhausted = false;
  const errors: { title: string; error: string }[] = [];

  // Allow Google Books for targeted use (covers, descriptions) when credits are available
  const useGoogleBooks = searchParams.get("useGoogleBooks") === "true";

  for (const book of needsWork) {
    try {
      await enrichBook(book.id, {
        skipGoogleBooks: !useGoogleBooks,
        ...(enrichFocus ? { focus: enrichFocus } : {}),
      });
      success++;
      console.log(
        `[re-enrich:${focus}] ✓ ${book.title} (${success}/${needsWork.length})`
      );
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
      console.error(`[re-enrich:${focus}] ✗ ${book.title}: ${msg}`);
    }
    // Shorter delay for lightweight modes (cover-only, audio)
    const delayMs = enrichFocus === "cover" ? 500 : enrichFocus === "audio" ? 800 : DELAY_MS;
    await delay(delayMs);
  }

  // Count remaining issues
  const remaining = await db.all(sql`
    SELECT
      (SELECT COUNT(*) FROM books WHERE summary IS NOT NULL AND LENGTH(summary) > 190) as long_summaries,
      (SELECT COUNT(*) FROM books WHERE cover_image_url IS NULL) as missing_covers,
      (SELECT COUNT(*) FROM books b WHERE NOT EXISTS (SELECT 1 FROM book_category_ratings bcr WHERE bcr.book_id = b.id)) as no_ratings,
      (SELECT COUNT(*) FROM books WHERE language IS NULL) as missing_language,
      (SELECT COUNT(*) FROM books WHERE description IS NULL) as missing_descriptions,
      (SELECT COUNT(*) FROM books WHERE audio_length_minutes IS NULL) as missing_audio
  `) as Record<string, number>[];

  return NextResponse.json({
    processed: success + failed,
    success,
    failed,
    apiExhausted: exhausted,
    errors,
    remainingIssues: remaining[0] ?? {},
  });
}
