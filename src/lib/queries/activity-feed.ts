import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getFollowedUserIds } from "./follows";
import { stripHtml, truncate } from "@/lib/text-utils";
import { parseDbDate } from "@/lib/date-utils";

export interface ActivityItem {
  // Reading notes are private to their author and are NOT a feed item. A
  // logged page/percent rides on the `currently_reading` item instead.
  type: "completed" | "review" | "rating" | "currently_reading" | "tbr";
  user: {
    id: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
  };
  book: {
    id: string;
    slug: string | null;
    title: string;
    coverImageUrl: string | null;
  };
  rating?: number | null;
  reviewPreview?: string | null;
  reviewId?: string | null;
  // Progress fields — only on `currently_reading` items, from the reader's
  // latest shared progress entry. The entry's note text never leaves the DB.
  percentComplete?: number | null;
  pageNumber?: number | null;
  timestamp: string;
}

/** The home-page rail: the newest `limit` items. */
export async function getFollowedUsersActivity(
  userId: string,
  limit = 20
): Promise<ActivityItem[]> {
  const { rows } = await loadActivityRows(userId, limit);
  return rows.slice(0, limit).map(toActivityItem);
}

/** How far back each source is read for the full activity page. */
const FEED_DEPTH = 200;

/**
 * One page of the full activity feed (`/activity`, GET /api/v1/friends-activity).
 *
 * Every page reads the same fixed window (FEED_DEPTH rows per source), so
 * paging is stable: page 2 can never reshuffle what page 1 showed. A source
 * that returned a full window has older rows we did not read, so the merged
 * list is only trustworthy down to the newest such cut-off (`horizon`) — the
 * feed ends there instead of showing a list with silent gaps.
 */
export async function getFollowedUsersActivityPage(
  userId: string,
  offset: number,
  limit: number
): Promise<{ items: ActivityItem[]; nextOffset: number | null }> {
  const { rows, horizon } = await loadActivityRows(userId, FEED_DEPTH);
  const reliable = rows.filter((r) => sortTime(r.timestamp) >= horizon);
  const end = offset + limit;
  return {
    items: reliable.slice(offset, end).map(toActivityItem),
    nextOffset: end < reliable.length ? end : null,
  };
}

/**
 * Reads up to `limit` rows from each source, merges them, and keeps one row
 * per reader + book. Returns the rows newest-first plus the `horizon`.
 */
async function loadActivityRows(
  userId: string,
  limit: number
): Promise<{ rows: RawActivityRow[]; horizon: number }> {
  const followedIds = await getFollowedUserIds(userId);
  if (followedIds.size === 0) return { rows: [], horizon: 0 };

  const inClause = sql.join([...followedIds].map((id) => sql`${id}`), sql`, `);

  // Run all 6 queries in parallel instead of sequentially
  const [completedRows, reviewRows, ratingRows, readingRows, tbrRows, progressRows] = await Promise.all([
    db.all(sql`
      SELECT
        'completed' as type,
        u.id as user_id, u.display_name, u.username, u.avatar_url,
        b.id as book_id, b.slug, b.title, b.cover_image_url,
        rs.completion_date as timestamp,
        NULL as rating, NULL as review_preview
      FROM reading_sessions rs
      INNER JOIN users u ON rs.user_id = u.id
      INNER JOIN books b ON rs.book_id = b.id
      WHERE rs.state = 'completed' AND rs.user_id IN (${inClause}) AND rs.completion_date IS NOT NULL
      ORDER BY rs.completion_date DESC LIMIT ${limit}
    `) as Promise<RawActivityRow[]>,

    db.all(sql`
      SELECT
        'review' as type,
        u.id as user_id, u.display_name, u.username, u.avatar_url,
        b.id as book_id, b.slug, b.title, b.cover_image_url,
        ubr.created_at as timestamp,
        ubr.overall_rating as rating, ubr.review_text as review_preview,
        ubr.id as review_id
      FROM user_book_reviews ubr
      INNER JOIN users u ON ubr.user_id = u.id
      INNER JOIN books b ON ubr.book_id = b.id
      WHERE ubr.is_anonymous = 0 AND ubr.user_id IN (${inClause})
      ORDER BY ubr.created_at DESC LIMIT ${limit}
    `) as Promise<RawActivityRow[]>,

    db.all(sql`
      SELECT
        'rating' as type,
        u.id as user_id, u.display_name, u.username, u.avatar_url,
        b.id as book_id, b.slug, b.title, b.cover_image_url,
        ubrat.updated_at as timestamp,
        ubrat.rating as rating, NULL as review_preview
      FROM user_book_ratings ubrat
      INNER JOIN users u ON ubrat.user_id = u.id
      INNER JOIN books b ON ubrat.book_id = b.id
      WHERE ubrat.user_id IN (${inClause})
      ORDER BY ubrat.updated_at DESC LIMIT ${limit}
    `) as Promise<RawActivityRow[]>,

    db.all(sql`
      SELECT
        'currently_reading' as type,
        u.id as user_id, u.display_name, u.username, u.avatar_url,
        b.id as book_id, b.slug, b.title, b.cover_image_url,
        ubs.updated_at as timestamp,
        NULL as rating, NULL as review_preview
      FROM user_book_state ubs
      INNER JOIN users u ON ubs.user_id = u.id
      INNER JOIN books b ON ubs.book_id = b.id
      WHERE ubs.state = 'currently_reading' AND ubs.user_id IN (${inClause})
      ORDER BY ubs.updated_at DESC LIMIT ${limit}
    `) as Promise<RawActivityRow[]>,

    db.all(sql`
      SELECT
        'tbr' as type,
        u.id as user_id, u.display_name, u.username, u.avatar_url,
        b.id as book_id, b.slug, b.title, b.cover_image_url,
        ubs.updated_at as timestamp,
        NULL as rating, NULL as review_preview
      FROM user_book_state ubs
      INNER JOIN users u ON ubs.user_id = u.id
      INNER JOIN books b ON ubs.book_id = b.id
      WHERE ubs.state = 'tbr' AND ubs.user_id IN (${inClause})
      ORDER BY ubs.updated_at DESC LIMIT ${limit}
    `) as Promise<RawActivityRow[]>,

    // Progress only (page / percent). A reading note's text is private to its
    // author: it is never selected here, and an entry with no page or percent
    // is not a feed item at all. Only entries the reader marked shared count,
    // and only while the book is still being read.
    db.all(sql`
      SELECT
        'progress' as type,
        u.id as user_id, u.display_name, u.username, u.avatar_url,
        b.id as book_id, b.slug, b.title, b.cover_image_url,
        rn.created_at as timestamp,
        NULL as rating, NULL as review_preview,
        rn.percent_complete as percent_complete,
        rn.page_number as page_number
      FROM reading_notes rn
      INNER JOIN users u ON rn.user_id = u.id
      INNER JOIN books b ON rn.book_id = b.id
      INNER JOIN user_book_state ubs
        ON ubs.user_id = rn.user_id AND ubs.book_id = rn.book_id AND ubs.state = 'currently_reading'
      WHERE rn.user_id IN (${inClause}) AND rn.is_private = 0
        AND (rn.percent_complete > 0 OR rn.page_number > 0)
      ORDER BY rn.created_at DESC LIMIT ${limit}
    `) as Promise<RawActivityRow[]>,
  ]);

  const sources = [completedRows, reviewRows, ratingRows, readingRows, tbrRows, progressRows];
  const allRows = sources.flat();

  // A source that filled its window has older rows we did not read.
  let horizon = 0;
  for (const source of sources) {
    if (source.length < limit) continue;
    const oldest = Math.min(...source.map((r) => sortTime(r.timestamp)));
    if (oldest > horizon) horizon = oldest;
  }

  // Deduplicate: if a user completed a book AND left a review, keep the review (richer data)
  const dedupKey = (r: RawActivityRow) => `${r.user_id}:${r.book_id}`;
  const seen = new Map<string, RawActivityRow>();

  // Sort by timestamp DESC first so we keep the most recent. Compare parsed
  // times, not strings: the sources mix ISO ("…T02:34:06.646Z"), naive UTC
  // ("… 02:34:06") and date-only values, which do not sort correctly as text.
  const byNewest = (a: RawActivityRow, b: RawActivityRow) => sortTime(b.timestamp) - sortTime(a.timestamp);
  allRows.sort(byNewest);

  for (const row of allRows) {
    const key = dedupKey(row);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, row);
    } else {
      // Priority: review > completed > rating > progress > currently_reading > tbr
      const priority: Record<string, number> = { review: 6, completed: 5, rating: 4, progress: 3, currently_reading: 2, tbr: 1 };
      if ((priority[row.type] ?? 0) > (priority[existing.type] ?? 0)) {
        seen.set(key, row);
      }
    }
  }

  return { rows: [...seen.values()].sort(byNewest), horizon };
}

function toActivityItem(r: RawActivityRow): ActivityItem {
    const stripped = r.review_preview ? stripHtml(r.review_preview) : null;
    const preview = stripped ? truncate(stripped, 160) : null;
    // A progress entry is published as "currently reading" + the position.
    const isProgress = r.type === "progress";
    return {
      type: (isProgress ? "currently_reading" : r.type) as ActivityItem["type"],
      user: {
        id: r.user_id,
        displayName: r.display_name,
        username: r.username,
        avatarUrl: r.avatar_url,
      },
      book: {
        id: r.book_id,
        slug: r.slug ?? null,
        title: r.title,
        coverImageUrl: r.cover_image_url,
      },
      rating: r.rating,
      reviewPreview: preview,
      reviewId: r.review_id ?? null,
      percentComplete: isProgress ? r.percent_complete ?? null : null,
      pageNumber: isProgress ? r.page_number ?? null : null,
      timestamp: r.timestamp ?? "",
    };
}

/** Epoch ms for any of the timestamp shapes the feed sources use. */
function sortTime(raw: string | null): number {
  if (!raw) return 0;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const t = dateOnly
    ? Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : parseDbDate(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

interface RawActivityRow {
  type: string;
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  book_id: string;
  slug: string | null;
  title: string;
  cover_image_url: string | null;
  timestamp: string | null;
  rating: number | null;
  review_preview: string | null;
  review_id?: string | null;
  percent_complete?: number | null;
  page_number?: number | null;
}
