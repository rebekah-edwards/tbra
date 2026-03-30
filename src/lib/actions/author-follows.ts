"use server";

import { db } from "@/db";
import { authorFollows } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function followAuthor(
  authorId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  try {
    const existing = await db
      .select({ userId: authorFollows.userId })
      .from(authorFollows)
      .where(
        and(
          eq(authorFollows.userId, session.userId),
          eq(authorFollows.authorId, authorId)
        )
      )
      .get();

    if (existing) return { success: true };

    await db.insert(authorFollows).values({
      userId: session.userId,
      authorId,
    });
  } catch {
    // Table may not exist on Turso yet
    return { success: false, error: "Follow not available yet" };
  }

  revalidatePath("/author/[id]", "page");
  return { success: true };
}

export async function unfollowAuthor(
  authorId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  try {
    await db
      .delete(authorFollows)
      .where(
        and(
          eq(authorFollows.userId, session.userId),
          eq(authorFollows.authorId, authorId)
        )
      );
  } catch {
    return { success: false, error: "Follow not available yet" };
  }

  revalidatePath("/author/[id]", "page");
  return { success: true };
}
