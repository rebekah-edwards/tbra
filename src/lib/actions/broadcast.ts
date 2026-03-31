"use server";

import { db } from "@/db";
import { users, userNotifications } from "@/db/schema";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { sql } from "drizzle-orm";

export async function sendBroadcastNotification(
  title: string,
  message: string
): Promise<{ success: boolean; count?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isSuperAdmin(user)) {
    return { success: false, error: "Unauthorized" };
  }

  if (!title.trim() || !message.trim()) {
    return { success: false, error: "Title and message are required" };
  }

  // Get all user IDs
  const allUsers = await db
    .select({ id: users.id })
    .from(users)
    .all();

  if (allUsers.length === 0) {
    return { success: false, error: "No users found" };
  }

  // Batch insert notifications for all users
  const batchSize = 100;
  for (let i = 0; i < allUsers.length; i += batchSize) {
    const batch = allUsers.slice(i, i + batchSize);
    await db.insert(userNotifications).values(
      batch.map((u) => ({
        userId: u.id,
        type: "broadcast",
        title: title.trim(),
        message: message.trim(),
      }))
    );
  }

  return { success: true, count: allUsers.length };
}
