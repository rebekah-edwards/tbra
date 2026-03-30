import { db } from "@/db";
import { authorFollows } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function isFollowingAuthor(
  userId: string,
  authorId: string
): Promise<boolean> {
  try {
    const row = await db
      .select({ userId: authorFollows.userId })
      .from(authorFollows)
      .where(
        and(
          eq(authorFollows.userId, userId),
          eq(authorFollows.authorId, authorId)
        )
      )
      .get();

    return !!row;
  } catch {
    // Table may not exist on Turso yet — graceful fallback
    return false;
  }
}

export async function getAuthorFollowerCount(authorId: string): Promise<number> {
  try {
    const row = await db
      .select({ count: sql<number>`count(*)` })
      .from(authorFollows)
      .where(eq(authorFollows.authorId, authorId))
      .get();

    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function getUserFollowedAuthorIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ authorId: authorFollows.authorId })
    .from(authorFollows)
    .where(eq(authorFollows.userId, userId))
    .all();

  return rows.map((r) => r.authorId);
}
