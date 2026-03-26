import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getFollowedUserIds } from "./follows";

export interface ActivityItem {
  type: "completed" | "review" | "rating" | "currently_reading" | "tbr" | "reading_note";
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
  timestamp: string;
}

export async function getFollowedUsersActivity(
  userId: string,
  limit = 20
): Promise<ActivityItem[]> {
  const followedIds = await getFollowedUserIds(userId);
  if (followedIds.size === 0) return [];

  const idList = [...followedIds].map((id) => `'${id.replace(/'/g, "''")}'`).join(",");

  // 1. Completed books (from reading_sessions where state = 'completed')
  const completedRows = await db.all(sql.raw(`
    SELECT
      'completed' as type,
      u.id as user_id,
      u.display_name,
      u.username,
      u.avatar_url,
      b.id as book_id,
      b.slug,
      b.title,
      b.cover_image_url,
      rs.completion_date as timestamp,
      NULL as rating,
      NULL as review_preview
    FROM reading_sessions rs
    INNER JOIN users u ON rs.user_id = u.id
    INNER JOIN books b ON rs.book_id = b.id
    WHERE rs.state = 'completed'
      AND rs.user_id IN (${idList})
      AND rs.completion_date IS NOT NULL
    ORDER BY rs.completion_date DESC
    LIMIT ${limit}
  `)) as RawActivityRow[];

  // 2. New reviews (non-anonymous only)
  const reviewRows = await db.all(sql.raw(`
    SELECT
      'review' as type,
      u.id as user_id,
      u.display_name,
      u.username,
      u.avatar_url,
      b.id as book_id,
      b.slug,
      b.title,
      b.cover_image_url,
      ubr.created_at as timestamp,
      ubr.overall_rating as rating,
      SUBSTR(ubr.review_text, 1, 100) as review_preview
    FROM user_book_reviews ubr
    INNER JOIN users u ON ubr.user_id = u.id
    INNER JOIN books b ON ubr.book_id = b.id
    WHERE ubr.is_anonymous = 0
      AND ubr.user_id IN (${idList})
    ORDER BY ubr.created_at DESC
    LIMIT ${limit}
  `)) as RawActivityRow[];

  // 3. New ratings
  const ratingRows = await db.all(sql.raw(`
    SELECT
      'rating' as type,
      u.id as user_id,
      u.display_name,
      u.username,
      u.avatar_url,
      b.id as book_id,
      b.slug,
      b.title,
      b.cover_image_url,
      ubrat.updated_at as timestamp,
      ubrat.rating as rating,
      NULL as review_preview
    FROM user_book_ratings ubrat
    INNER JOIN users u ON ubrat.user_id = u.id
    INNER JOIN books b ON ubrat.book_id = b.id
    WHERE ubrat.user_id IN (${idList})
    ORDER BY ubrat.updated_at DESC
    LIMIT ${limit}
  `)) as RawActivityRow[];

  // 4. Currently reading (state changes)
  const readingRows = await db.all(sql.raw(`
    SELECT
      'currently_reading' as type,
      u.id as user_id,
      u.display_name,
      u.username,
      u.avatar_url,
      b.id as book_id,
      b.slug,
      b.title,
      b.cover_image_url,
      ubs.updated_at as timestamp,
      NULL as rating,
      NULL as review_preview
    FROM user_book_state ubs
    INNER JOIN users u ON ubs.user_id = u.id
    INNER JOIN books b ON ubs.book_id = b.id
    WHERE ubs.state = 'currently_reading'
      AND ubs.user_id IN (${idList})
    ORDER BY ubs.updated_at DESC
    LIMIT ${limit}
  `)) as RawActivityRow[];

  // 5. Added to TBR
  const tbrRows = await db.all(sql.raw(`
    SELECT
      'tbr' as type,
      u.id as user_id,
      u.display_name,
      u.username,
      u.avatar_url,
      b.id as book_id,
      b.slug,
      b.title,
      b.cover_image_url,
      ubs.updated_at as timestamp,
      NULL as rating,
      NULL as review_preview
    FROM user_book_state ubs
    INNER JOIN users u ON ubs.user_id = u.id
    INNER JOIN books b ON ubs.book_id = b.id
    WHERE ubs.state = 'tbr'
      AND ubs.user_id IN (${idList})
    ORDER BY ubs.updated_at DESC
    LIMIT ${limit}
  `)) as RawActivityRow[];

  // 6. Reading notes
  const noteRows = await db.all(sql.raw(`
    SELECT
      'reading_note' as type,
      u.id as user_id,
      u.display_name,
      u.username,
      u.avatar_url,
      b.id as book_id,
      b.slug,
      b.title,
      b.cover_image_url,
      rn.created_at as timestamp,
      NULL as rating,
      SUBSTR(rn.note_text, 1, 100) as review_preview
    FROM reading_notes rn
    INNER JOIN users u ON rn.user_id = u.id
    INNER JOIN books b ON rn.book_id = b.id
    WHERE rn.user_id IN (${idList})
    ORDER BY rn.created_at DESC
    LIMIT ${limit}
  `)) as RawActivityRow[];

  // Merge all events
  const allRows = [...completedRows, ...reviewRows, ...ratingRows, ...readingRows, ...tbrRows, ...noteRows];

  // Deduplicate: if a user completed a book AND left a review, keep the review (richer data)
  const dedupKey = (r: RawActivityRow) => `${r.user_id}:${r.book_id}`;
  const seen = new Map<string, RawActivityRow>();

  // Sort by timestamp DESC first so we keep the most recent
  allRows.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));

  for (const row of allRows) {
    const key = dedupKey(row);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, row);
    } else {
      // Priority: review > completed > rating > reading_note > currently_reading > tbr
      const priority: Record<string, number> = { review: 6, completed: 5, rating: 4, reading_note: 3, currently_reading: 2, tbr: 1 };
      if ((priority[row.type] ?? 0) > (priority[existing.type] ?? 0)) {
        seen.set(key, row);
      }
    }
  }

  // Sort final list and limit
  const deduped = [...seen.values()]
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, limit);

  return deduped.map((r) => ({
    type: r.type as ActivityItem["type"],
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
    reviewPreview: r.review_preview,
    timestamp: r.timestamp ?? "",
  }));
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
}
