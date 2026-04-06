"use server";

import { db } from "@/db";
import { userFollows, userNotifications, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function followUser(
  targetUserId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  if (session.userId === targetUserId) {
    return { success: false, error: "Cannot follow yourself" };
  }

  // Check if already following
  const existing = await db
    .select({ followerId: userFollows.followerId })
    .from(userFollows)
    .where(
      and(
        eq(userFollows.followerId, session.userId),
        eq(userFollows.followedId, targetUserId)
      )
    )
    .get();

  if (existing) return { success: true }; // Already following

  await db.insert(userFollows).values({
    followerId: session.userId,
    followedId: targetUserId,
  });

  // Notify the followed user
  try {
    const follower = await db
      .select({ displayName: users.displayName, username: users.username })
      .from(users)
      .where(eq(users.id, session.userId))
      .get();

    const followerName = follower?.displayName || (follower?.username ? `@${follower.username}` : "Someone");

    await db.insert(userNotifications).values({
      userId: targetUserId,
      type: "new_follower",
      title: "New follower",
      message: `${followerName} started following you`,
      linkUrl: follower?.username ? `/u/${follower.username}` : undefined,
    });
  } catch (err) {
    console.error("[follows] Failed to create notification:", err);
  }

  revalidatePath("/");
  revalidatePath("/u/[username]", "page");
  return { success: true };
}

export async function unfollowUser(
  targetUserId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  await db
    .delete(userFollows)
    .where(
      and(
        eq(userFollows.followerId, session.userId),
        eq(userFollows.followedId, targetUserId)
      )
    );

  revalidatePath("/");
  revalidatePath("/u/[username]", "page");
  return { success: true };
}
