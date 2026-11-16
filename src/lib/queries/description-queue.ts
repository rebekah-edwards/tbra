import { db } from "@/db";
import { sql } from "drizzle-orm";

export type DescriptionQueueTab = "active" | "all";

export type DescriptionQueueBook = {
  id: string;
  title: string;
  slug: string | null;
  coverImageUrl: string | null;
  publicationYear: number | null;
  authorNames: string[];
  /** Existing text on a stale-flagged book — reference only. */
  staleDescription: string | null;
  /** Distinct readers with the book shelved / owned / read / rated / reviewed. */
  readers: number;
  shelved: number;
  sessions: number;
  ratings: number;
  reviews: number;
};

export const DESCRIPTION_QUEUE_PAGE_SIZE = 50;

/**
 * "This book needs a description."
 *
 * MUST stay identical to `selectBatch()` in scripts/description-refresh.ts —
 * the nightly lane and this manual queue are two workers on the same backlog,
 * and if the definitions drift a book can sit in one and be invisible to the
 * other. The save action (src/lib/actions/descriptions.ts) re-checks the same
 * three description conditions before writing.
 */
const NEEDS_DESCRIPTION = `
  b.visibility = 'public'
  AND (b.description_stale = 1
       OR b.description IS NULL
       OR TRIM(b.description) = '')
`;

/**
 * Reader activity per book, aggregated ONCE over the four activity tables
 * (~38k rows total, all read from covering indexes) instead of a correlated
 * subquery per candidate book. None of these tables has an index leading on
 * book_id for user_book_state / reading_sessions, so the per-book shape used
 * elsewhere costs a scan (or an automatic index) per row.
 *
 *   readers  — distinct users who have the book on a shelf / own it / have a
 *              reading session, a rating or a review. The headline number.
 *   shelved / sessions / ratings / reviews — the breakdown shown on the row.
 *
 * user_book_state rows with state NULL and no owned format are soft-delete
 * tombstones ("removed from library" — sync never hard-deletes), so they are
 * not counted as activity.
 */
const ACTIVITY_CTE = `
  WITH activity AS (
    SELECT book_id,
           count(DISTINCT user_id) AS readers,
           sum(kind = 1) AS shelved,
           sum(kind = 2) AS sessions,
           sum(kind = 3) AS ratings,
           sum(kind = 4) AS reviews
    FROM (
      SELECT book_id, user_id, 1 AS kind FROM user_book_state
       WHERE state IS NOT NULL
          OR (owned_formats IS NOT NULL AND owned_formats NOT IN ('', '[]'))
      UNION ALL
      SELECT book_id, user_id, 2 FROM reading_sessions
      UNION ALL
      SELECT book_id, user_id, 3 FROM user_book_ratings
      UNION ALL
      SELECT book_id, user_id, 4 FROM user_book_reviews
    )
    GROUP BY book_id
  )
`;

const AUTHOR_NAMES = `
  (SELECT group_concat(au.name, '|')
     FROM book_authors ba
     JOIN authors au ON au.id = ba.author_id
    WHERE ba.book_id = b.id) AS author_names
`;

type Row = {
  id: string;
  title: string;
  slug: string | null;
  cover_image_url: string | null;
  publication_year: number | null;
  description: string | null;
  description_stale: number | null;
  readers: number | null;
  shelved: number | null;
  sessions: number | null;
  ratings: number | null;
  reviews: number | null;
  author_names: string | null;
};

export async function loadDescriptionQueue(
  tab: DescriptionQueueTab,
  offset: number,
): Promise<DescriptionQueueBook[]> {
  // Two shapes, one statement each:
  //
  //  active — drive FROM the activity aggregate and look each book up by
  //           primary key. CROSS JOIN pins that join order (SQLite never
  //           reorders a CROSS JOIN), so the plan can't flip to "walk every
  //           public book" if Turso's planner statistics differ from local.
  //
  //  all    — every book in the queue has to be ranked, so this one does walk
  //           the public books; activity is LEFT JOINed and missing = 0.
  //
  // Ordering: most distinct readers first, then total sessions + ratings +
  // reviews, then title and id so paging is stable.
  const query =
    tab === "active"
      ? sql`
          ${sql.raw(ACTIVITY_CTE)}
          SELECT b.id, b.title, b.slug, b.cover_image_url, b.publication_year,
                 b.description, b.description_stale,
                 a.readers, a.shelved, a.sessions, a.ratings, a.reviews,
                 ${sql.raw(AUTHOR_NAMES)}
          FROM activity a
          CROSS JOIN books b ON b.id = a.book_id
          WHERE ${sql.raw(NEEDS_DESCRIPTION)}
          ORDER BY a.readers DESC,
                   (a.sessions + a.ratings + a.reviews) DESC,
                   b.title COLLATE NOCASE ASC,
                   b.id ASC
          LIMIT ${DESCRIPTION_QUEUE_PAGE_SIZE} OFFSET ${offset}
        `
      : sql`
          ${sql.raw(ACTIVITY_CTE)}
          SELECT b.id, b.title, b.slug, b.cover_image_url, b.publication_year,
                 b.description, b.description_stale,
                 COALESCE(a.readers, 0) AS readers,
                 COALESCE(a.shelved, 0) AS shelved,
                 COALESCE(a.sessions, 0) AS sessions,
                 COALESCE(a.ratings, 0) AS ratings,
                 COALESCE(a.reviews, 0) AS reviews,
                 ${sql.raw(AUTHOR_NAMES)}
          FROM books b
          LEFT JOIN activity a ON a.book_id = b.id
          WHERE ${sql.raw(NEEDS_DESCRIPTION)}
          ORDER BY COALESCE(a.readers, 0) DESC,
                   COALESCE(a.sessions + a.ratings + a.reviews, 0) DESC,
                   b.title COLLATE NOCASE ASC,
                   b.id ASC
          LIMIT ${DESCRIPTION_QUEUE_PAGE_SIZE} OFFSET ${offset}
        `;

  const rows: Row[] = await db.all(query);

  return rows.map((r) => {
    const existing = r.description?.trim() ?? "";
    return {
      id: r.id,
      title: r.title,
      slug: r.slug,
      coverImageUrl: r.cover_image_url,
      publicationYear: r.publication_year,
      authorNames: r.author_names ? r.author_names.split("|").filter(Boolean) : [],
      // Only a stale-flagged description can be non-blank here; shown to the
      // worker for reference, never as something to keep as-is.
      staleDescription: existing.length > 0 ? existing : null,
      readers: Number(r.readers ?? 0),
      shelved: Number(r.shelved ?? 0),
      sessions: Number(r.sessions ?? 0),
      ratings: Number(r.ratings ?? 0),
      reviews: Number(r.reviews ?? 0),
    };
  });
}

/** Both tab totals from a single pass over the queue. */
export async function loadDescriptionQueueCounts(): Promise<Record<DescriptionQueueTab, number>> {
  const rows: { all_count: number | null; active_count: number | null }[] = await db.all(sql`
    ${sql.raw(ACTIVITY_CTE)}
    SELECT count(*) AS all_count, count(a.book_id) AS active_count
    FROM books b
    LEFT JOIN activity a ON a.book_id = b.id
    WHERE ${sql.raw(NEEDS_DESCRIPTION)}
  `);
  return {
    active: Number(rows[0]?.active_count ?? 0),
    all: Number(rows[0]?.all_count ?? 0),
  };
}
