import { NextResponse } from "next/server";
import { db } from "@/db";
import { enrichmentLog, books, bookCategoryRatings } from "@/db/schema";
import { sql, eq, isNull } from "drizzle-orm";

/**
 * GET /api/enrichment/status
 *
 * Returns enrichment status summary — how many books are enriched,
 * how many need enrichment, and whether any API exhaustion errors occurred recently.
 *
 * This endpoint is public (no auth required) so it can be checked from a browser
 * or a monitoring tool without needing to log in.
 */
export async function GET() {
  // Total books in DB
  const totalBooks = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .get();

  // Books with summaries (enriched)
  const enrichedBooks = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(sql`summary IS NOT NULL`)
    .get();

  // Books with content ratings
  const booksWithRatings = await db
    .select({ count: sql<number>`count(DISTINCT book_id)` })
    .from(bookCategoryRatings)
    .get();

  // Books still needing enrichment (no summary AND no content ratings)
  const needsEnrichment = await db.all(sql`
    SELECT count(*) as count FROM books b
    WHERE b.summary IS NULL
    AND NOT EXISTS (SELECT 1 FROM book_category_ratings bcr WHERE bcr.book_id = b.id)
  `) as { count: number }[];

  // Recent API exhaustion errors (last 24 hours)
  const recentExhaustion = await db.all(sql`
    SELECT count(*) as count, MAX(created_at) as last_at
    FROM enrichment_log
    WHERE status = 'api_exhausted'
    AND created_at > datetime('now', '-24 hours')
  `) as { count: number; last_at: string | null }[];

  // Recent failures (last 24 hours)
  const recentFailures = await db.all(sql`
    SELECT count(*) as count
    FROM enrichment_log
    WHERE status = 'failed'
    AND created_at > datetime('now', '-24 hours')
  `) as { count: number }[];

  // Recent successes (last 24 hours)
  const recentSuccesses = await db.all(sql`
    SELECT count(*) as count
    FROM enrichment_log
    WHERE status = 'success'
    AND created_at > datetime('now', '-24 hours')
  `) as { count: number }[];

  const exhaustionInfo = recentExhaustion[0];
  const isApiExhausted = (exhaustionInfo?.count ?? 0) > 0;

  const isPaused = process.env.ENRICHMENT_PAUSED === "true";

  return NextResponse.json({
    totalBooks: totalBooks?.count ?? 0,
    enrichedBooks: enrichedBooks?.count ?? 0,
    booksWithContentRatings: booksWithRatings?.count ?? 0,
    needsEnrichment: needsEnrichment[0]?.count ?? 0,
    paused: isPaused,
    last24Hours: {
      successes: recentSuccesses[0]?.count ?? 0,
      failures: recentFailures[0]?.count ?? 0,
      apiExhausted: exhaustionInfo?.count ?? 0,
    },
    apiExhausted: isApiExhausted,
    lastExhaustionAt: isApiExhausted ? exhaustionInfo?.last_at : null,
    alert: isPaused
      ? "Enrichment is PAUSED. Set ENRICHMENT_PAUSED=false in .env.local to resume."
      : isApiExhausted
        ? `API credits exhausted! Last failure at ${exhaustionInfo?.last_at}. Check Brave Search and Grok (xAI) credit balances.`
        : null,
  });
}
