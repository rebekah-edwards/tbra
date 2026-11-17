import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * User blocks (App Review guideline 1.2).
 *
 * A row in `user_blocks` cuts contact in BOTH directions: the blocker stops
 * seeing the blocked reader's reviews, profile, search result and buddy-read
 * messages, and the blocked reader stops seeing the blocker's. Callers
 * therefore almost always want `getHiddenUserIds`, the union of both sides.
 *
 * Reads fail OPEN (an empty set) with a logged error: a broken block lookup
 * must never take down a book page. Writes live in src/lib/actions/blocks.ts.
 */

/** Everyone `viewerId` should not see: readers they blocked, plus readers who blocked them. */
export async function getHiddenUserIds(viewerId: string | null | undefined): Promise<Set<string>> {
  if (!viewerId) return new Set();
  try {
    const rows = (await db.all(sql`
      SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = ${viewerId}
      UNION
      SELECT blocker_id AS id FROM user_blocks WHERE blocked_id = ${viewerId}
    `)) as { id: string }[];
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    console.error("[blocks] getHiddenUserIds failed:", err);
    return new Set();
  }
}

/** How two readers stand. `viewerBlocked`: the viewer blocked the other. `blockedViewer`: the reverse. */
export async function getBlockRelation(
  viewerId: string | null | undefined,
  otherId: string
): Promise<{ viewerBlocked: boolean; blockedViewer: boolean }> {
  if (!viewerId || viewerId === otherId) return { viewerBlocked: false, blockedViewer: false };
  try {
    const rows = (await db.all(sql`
      SELECT blocker_id FROM user_blocks
      WHERE (blocker_id = ${viewerId} AND blocked_id = ${otherId})
         OR (blocker_id = ${otherId} AND blocked_id = ${viewerId})
    `)) as { blocker_id: string }[];
    return {
      viewerBlocked: rows.some((r) => r.blocker_id === viewerId),
      blockedViewer: rows.some((r) => r.blocker_id === otherId),
    };
  } catch (err) {
    console.error("[blocks] getBlockRelation failed:", err);
    return { viewerBlocked: false, blockedViewer: false };
  }
}

export interface BlockedUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  blockedAt: string;
}

/** The readers `viewerId` has blocked, newest first — the Settings list. */
export async function getBlockedUsers(viewerId: string): Promise<BlockedUser[]> {
  try {
    return (await db.all(sql`
      SELECT u.id, u.username, u.display_name AS displayName, u.avatar_url AS avatarUrl,
             b.created_at AS blockedAt
      FROM user_blocks b
      JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ${viewerId}
      ORDER BY b.created_at DESC
    `)) as BlockedUser[];
  } catch (err) {
    console.error("[blocks] getBlockedUsers failed:", err);
    return [];
  }
}
