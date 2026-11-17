import { db } from "@/db";
import { userFollows, users, userBookState, userBookRatings } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { stripHtml, truncate } from "@/lib/text-utils";

export async function getFollowerCount(userId: string): Promise<number> {
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(userFollows)
    .where(eq(userFollows.followedId, userId))
    .get();

  return row?.count ?? 0;
}

export async function getFollowingCount(userId: string): Promise<number> {
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(userFollows)
    .where(eq(userFollows.followerId, userId))
    .get();

  return row?.count ?? 0;
}

export async function isFollowing(
  currentUserId: string,
  targetUserId: string
): Promise<boolean> {
  const row = await db
    .select({ followerId: userFollows.followerId })
    .from(userFollows)
    .where(
      and(
        eq(userFollows.followerId, currentUserId),
        eq(userFollows.followedId, targetUserId)
      )
    )
    .get();

  return !!row;
}

export async function getFollowedUserIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ followedId: userFollows.followedId })
    .from(userFollows)
    .where(eq(userFollows.followerId, userId))
    .all();

  return new Set(rows.map((r) => r.followedId));
}

export interface FollowUser {
  userId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export async function getFollowers(
  userId: string,
  limit = 50
): Promise<FollowUser[]> {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarUrl: users.avatarUrl,
    })
    .from(userFollows)
    .innerJoin(users, eq(userFollows.followerId, users.id))
    .where(eq(userFollows.followedId, userId))
    .limit(limit)
    .all();

  return rows;
}

export async function getFollowing(
  userId: string,
  limit = 50
): Promise<FollowUser[]> {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarUrl: users.avatarUrl,
    })
    .from(userFollows)
    .innerJoin(users, eq(userFollows.followedId, users.id))
    .where(eq(userFollows.followerId, userId))
    .limit(limit)
    .all();

  return rows;
}

export interface FriendWhoRead {
  userId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  state: string | null;
  rating: number | null;
  reviewId: string | null;
  /** True only when they have a SHARED note on this book. */
  hasNotes: boolean;
  /** Their latest note on this book that they marked shared; never a private one. */
  sharedNote: string | null;
}

export async function getFollowedUsersWhoRead(
  currentUserId: string,
  bookId: string
): Promise<FriendWhoRead[]> {
  const rows = await db.all(sql`
    SELECT
      u.id as user_id,
      u.display_name,
      u.username,
      u.avatar_url,
      ubs.state,
      ubr.rating,
      rev.id as review_id,
      -- Shared notes only (is_private = 0). A private note is not even counted:
      -- it used to make this row announce "left reading notes".
      (SELECT rn.note_text FROM reading_notes rn
        WHERE rn.user_id = uf.followed_id AND rn.book_id = ${bookId}
          AND rn.is_private = 0 AND TRIM(rn.note_text) != ''
        ORDER BY rn.created_at DESC LIMIT 1) as shared_note
    FROM user_follows uf
    INNER JOIN user_book_state ubs
      ON uf.followed_id = ubs.user_id AND ubs.book_id = ${bookId}
    INNER JOIN users u ON uf.followed_id = u.id
    LEFT JOIN user_book_ratings ubr
      ON uf.followed_id = ubr.user_id AND ubr.book_id = ${bookId}
    LEFT JOIN user_book_reviews rev
      ON uf.followed_id = rev.user_id AND rev.book_id = ${bookId}
    WHERE uf.follower_id = ${currentUserId}
      AND ubs.state IN ('completed', 'currently_reading', 'tbr')
    ORDER BY
      CASE ubs.state
        WHEN 'completed' THEN 1
        WHEN 'currently_reading' THEN 2
        WHEN 'tbr' THEN 3
      END ASC
  `) as {
    user_id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    state: string | null;
    rating: number | null;
    review_id: string | null;
    shared_note: string | null;
  }[];

  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    avatarUrl: r.avatar_url,
    state: r.state,
    rating: r.rating,
    reviewId: r.review_id,
    hasNotes: !!r.shared_note,
    sharedNote: r.shared_note ? truncate(stripHtml(r.shared_note), 140) : null,
  }));
}
