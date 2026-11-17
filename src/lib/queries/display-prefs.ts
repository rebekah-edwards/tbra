import { db } from "@/db";
import { userReadingPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Which motivation surfaces the reader has switched off. Some readers find a
 * goal or a streak takes away from reading; each can be hidden on its own.
 * Hidden means hidden everywhere (Home, Stats, the iOS widget) — the numbers
 * keep counting underneath, so switching one back on shows the real figure.
 */
export interface DisplayPrefs {
  hideGoal: boolean;
  hideStreak: boolean;
}

export async function getDisplayPrefs(userId: string): Promise<DisplayPrefs> {
  const row = await db
    .select({ hideGoal: userReadingPreferences.hideGoal, hideStreak: userReadingPreferences.hideStreak })
    .from(userReadingPreferences)
    .where(eq(userReadingPreferences.userId, userId))
    .get();
  return { hideGoal: !!row?.hideGoal, hideStreak: !!row?.hideStreak };
}

/** Upserts only the keys given; a reader with no preferences row yet gets one. */
export async function setDisplayPrefs(userId: string, change: Partial<DisplayPrefs>): Promise<DisplayPrefs> {
  const fields: Partial<DisplayPrefs> = {};
  if (typeof change.hideGoal === "boolean") fields.hideGoal = change.hideGoal;
  if (typeof change.hideStreak === "boolean") fields.hideStreak = change.hideStreak;
  if (Object.keys(fields).length > 0) {
    // updated_at drives the two-way sync for this table — always stamp it.
    const stamped = { ...fields, updatedAt: new Date().toISOString() };
    await db
      .insert(userReadingPreferences)
      .values({ userId, ...stamped })
      .onConflictDoUpdate({ target: userReadingPreferences.userId, set: stamped })
      .run();
  }
  return getDisplayPrefs(userId);
}
