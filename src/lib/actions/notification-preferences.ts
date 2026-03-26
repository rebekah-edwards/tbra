"use server";

import { db } from "@/db";
import { userNotificationPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export interface NotificationPrefs {
  emailNewFollower: boolean;
  emailNewCorrection: boolean;
  emailWeeklyDigest: boolean;
}

const DEFAULTS: NotificationPrefs = {
  emailNewFollower: true,
  emailNewCorrection: true,
  emailWeeklyDigest: false,
};

export async function getNotificationPreferences(
  userId: string
): Promise<NotificationPrefs> {
  const row = await db.query.userNotificationPreferences.findFirst({
    where: eq(userNotificationPreferences.userId, userId),
  });

  if (!row) return DEFAULTS;

  return {
    emailNewFollower: row.emailNewFollower,
    emailNewCorrection: row.emailNewCorrection,
    emailWeeklyDigest: row.emailWeeklyDigest,
  };
}

export async function updateNotificationPreferences(
  prefs: Partial<NotificationPrefs>
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  const existing = await db.query.userNotificationPreferences.findFirst({
    where: eq(userNotificationPreferences.userId, session.userId),
  });

  const now = new Date().toISOString();

  if (existing) {
    await db
      .update(userNotificationPreferences)
      .set({ ...prefs, updatedAt: now })
      .where(eq(userNotificationPreferences.userId, session.userId));
  } else {
    await db.insert(userNotificationPreferences).values({
      userId: session.userId,
      emailNewFollower: prefs.emailNewFollower ?? DEFAULTS.emailNewFollower,
      emailNewCorrection: prefs.emailNewCorrection ?? DEFAULTS.emailNewCorrection,
      emailWeeklyDigest: prefs.emailWeeklyDigest ?? DEFAULTS.emailWeeklyDigest,
      updatedAt: now,
    });
  }

  return { success: true };
}
