"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { setDisplayPrefs, type DisplayPrefs } from "@/lib/queries/display-prefs";

/** Web: hide or show the reading goal / streak (Settings, or the goal card's opt-out). */
export async function updateDisplayPrefs(
  change: Partial<DisplayPrefs>
): Promise<{ success: boolean; prefs?: DisplayPrefs; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };
  const prefs = await setDisplayPrefs(session.userId, change);
  revalidatePath("/");
  revalidatePath("/stats");
  revalidatePath("/settings");
  return { success: true, prefs };
}
