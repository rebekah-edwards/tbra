import { db } from "@/db";
import { readingSessions, books, bookGenres, genres, bookAuthors, authors, userBookRatings } from "@/db/schema";
import { eq, and, like, sql, isNotNull } from "drizzle-orm";

/**
 * Year filter helper: when year is set, filters by year AND excludes synthetic dates.
 * For all-time (no year), includes everything.
 */
const yearFilter = (year: number | undefined, alias = "") => {
  if (!year) return sql``;
  const col = alias ? sql.raw(`${alias}.completion_date`) : sql.raw("completion_date");
  const precCol = alias ? sql.raw(`${alias}.completion_precision`) : sql.raw("completion_precision");
  return sql`AND ${col} LIKE ${year + '-%'} AND ${precCol} IS NOT NULL`;
};

/**
 * Deduplicated completed books subquery.
 * Re-imports can create multiple reading_sessions per book.
 * This CTE selects one row per book_id using the most recent completion_date.
 */
const deduped = (userId: string, year: number | undefined) => sql`
  deduped_sessions AS (
    SELECT book_id, MAX(completion_date) as completion_date, completion_precision
    FROM reading_sessions
    WHERE user_id = ${userId}
      AND state = 'completed'
      AND completion_date IS NOT NULL
      ${yearFilter(year)}
    GROUP BY book_id
  )
`;

/** Books completed grouped by month */
export async function getCompletedBooksByMonth(
  userId: string,
  year?: number
): Promise<{ month: string; count: number }[]> {
  const rows = await db.all(sql`
    WITH ${deduped(userId, year)}
    SELECT substr(completion_date, 1, 7) as month, count(*) as count
    FROM deduped_sessions
    GROUP BY substr(completion_date, 1, 7)
    ORDER BY month
  `) as { month: string; count: number }[];

  return rows;
}

/** Genre breakdown for completed books — rolls up child genres to parent categories */
export async function getGenreBreakdown(
  userId: string,
  year?: number
): Promise<{ genre: string; count: number }[]> {
  const rows = await db.all(sql`
    WITH ${deduped(userId, year)}
    SELECT COALESCE(parent.name, g.name) as genre, count(DISTINCT ds.book_id) as count
    FROM deduped_sessions ds
    JOIN book_genres bg ON ds.book_id = bg.book_id
    JOIN genres g ON bg.genre_id = g.id
    LEFT JOIN genres parent ON g.parent_genre_id = parent.id
    GROUP BY COALESCE(parent.name, g.name)
    HAVING COALESCE(parent.name, g.name) != 'Own Voices'
    ORDER BY count DESC
    LIMIT 10
  `) as { genre: string; count: number }[];

  return rows;
}

/** Rating distribution (0.5 buckets) */
export async function getRatingDistribution(
  userId: string,
  year?: number
): Promise<{ bucket: string; count: number }[]> {
  const rows = await db.all(sql`
    ${year ? sql`WITH ${deduped(userId, year)}` : sql``}
    SELECT
      CASE
        WHEN r.rating <= 0.5 THEN '0.5'
        WHEN r.rating <= 1.0 THEN '1'
        WHEN r.rating <= 1.5 THEN '1.5'
        WHEN r.rating <= 2.0 THEN '2'
        WHEN r.rating <= 2.5 THEN '2.5'
        WHEN r.rating <= 3.0 THEN '3'
        WHEN r.rating <= 3.5 THEN '3.5'
        WHEN r.rating <= 4.0 THEN '4'
        WHEN r.rating <= 4.5 THEN '4.5'
        ELSE '5'
      END as bucket,
      count(*) as count
    FROM user_book_ratings r
    ${year ? sql`JOIN deduped_sessions ds ON r.book_id = ds.book_id` : sql``}
    WHERE r.user_id = ${userId}
    GROUP BY bucket
    ORDER BY CAST(bucket as REAL)
  `) as { bucket: string; count: number }[];

  return rows;
}

/** Most-read authors */
export async function getMostReadAuthors(
  userId: string,
  limit = 5,
  year?: number
): Promise<{ author: string; count: number }[]> {
  const rows = await db.all(sql`
    WITH ${deduped(userId, year)}
    SELECT a.name as author, count(DISTINCT ds.book_id) as count
    FROM deduped_sessions ds
    JOIN book_authors ba ON ds.book_id = ba.book_id
    JOIN authors a ON ba.author_id = a.id
    GROUP BY a.name
    ORDER BY count DESC
    LIMIT ${limit}
  `) as { author: string; count: number }[];

  return rows;
}

/** Average reading pace (active reading days, excluding paused periods) */
export async function getReadingPace(
  userId: string,
  year?: number
): Promise<{ avgDays: number; totalBooks: number } | null> {
  const rows = await db.all(sql`
    SELECT
      AVG(MAX(julianday(completion_date) - julianday(date(started_at)) - COALESCE(total_paused_days, 0), 0)) as avg_days,
      count(DISTINCT book_id) as total
    FROM reading_sessions
    WHERE user_id = ${userId}
      AND state = 'completed'
      AND completion_date IS NOT NULL
      AND started_at IS NOT NULL
      AND started_at != completion_date
      ${yearFilter(year)}
  `) as { avg_days: number | null; total: number }[];

  if (!rows[0] || !rows[0].avg_days) return null;
  return { avgDays: Math.max(Math.round(rows[0].avg_days), 0), totalBooks: rows[0].total };
}

/** Total pages read */
export async function getPageStats(
  userId: string,
  year?: number
): Promise<{ totalPages: number; bookCount: number }> {
  const rows = await db.all(sql`
    WITH ${deduped(userId, year)}
    SELECT
      COALESCE(SUM(CASE WHEN b.pages IS NOT NULL THEN b.pages ELSE 0 END), 0) as total_pages,
      COUNT(*) as book_count
    FROM deduped_sessions ds
    JOIN books b ON ds.book_id = b.id
  `) as { total_pages: number; book_count: number }[];

  return { totalPages: rows[0]?.total_pages ?? 0, bookCount: rows[0]?.book_count ?? 0 };
}

/** Pages read grouped by month */
export async function getPagesByMonth(
  userId: string,
  year?: number
): Promise<{ month: string; pages: number }[]> {
  const rows = await db.all(sql`
    WITH ${deduped(userId, year)}
    SELECT substr(ds.completion_date, 1, 7) as month, COALESCE(SUM(b.pages), 0) as pages
    FROM deduped_sessions ds
    JOIN books b ON ds.book_id = b.id
    GROUP BY substr(ds.completion_date, 1, 7)
    ORDER BY month
  `) as { month: string; pages: number }[];

  return rows;
}

/** Total audiobook minutes listened for completed sessions where user actually used audiobook format */
export async function getMinutesListened(
  userId: string,
  year?: number
): Promise<number> {
  const rows = await db.all(sql`
    WITH audio_sessions AS (
      SELECT book_id, MAX(completion_date) as completion_date, completion_precision
      FROM reading_sessions
      WHERE user_id = ${userId}
        AND state = 'completed'
        AND completion_date IS NOT NULL
        AND active_formats LIKE '%audiobook%'
        ${yearFilter(year)}
      GROUP BY book_id
    )
    SELECT COALESCE(SUM(b.audio_length_minutes), 0) as total_minutes
    FROM audio_sessions als
    JOIN books b ON als.book_id = b.id
    WHERE b.audio_length_minutes IS NOT NULL
  `) as { total_minutes: number }[];

  return rows[0]?.total_minutes ?? 0;
}

/** Fiction vs nonfiction split */
export async function getFictionNonfictionSplit(
  userId: string,
  year?: number
): Promise<{ fiction: number; nonfiction: number }> {
  const rows = await db.all(sql`
    WITH ${deduped(userId, year)}
    SELECT
      SUM(CASE WHEN b.is_fiction = 1 THEN 1 ELSE 0 END) as fiction,
      SUM(CASE WHEN b.is_fiction = 0 THEN 1 ELSE 0 END) as nonfiction
    FROM deduped_sessions ds
    JOIN books b ON ds.book_id = b.id
  `) as { fiction: number; nonfiction: number }[];

  return { fiction: rows[0]?.fiction ?? 0, nonfiction: rows[0]?.nonfiction ?? 0 };
}
