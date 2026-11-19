"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isPremium } from "@/lib/auth";
import { setCustomGoalFor, removeCustomGoalFor, setAudioLengthFor, setPageCountFor } from "@/lib/mutations/custom-goals";

const PREMIUM_ONLY = "Custom goals are a Based Reader feature.";

export async function setCustomGoal(input: { kind: string; target: number; genreName?: string | null }) {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };
  if (!isPremium(user)) return { success: false, error: PREMIUM_ONLY };
  const result = await setCustomGoalFor(user.userId, input);
  if (result.success) revalidatePath("/stats");
  return result;
}

export async function removeCustomGoal(goalId: string) {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };
  const result = await removeCustomGoalFor(user.userId, goalId);
  if (result.success) revalidatePath("/stats");
  return result;
}

export async function setAudioLength(bookId: string, minutes: number) {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };
  if (!isPremium(user)) return { success: false, error: PREMIUM_ONLY };
  const result = await setAudioLengthFor(user.userId, bookId, minutes);
  if (result.success) revalidatePath("/stats");
  return result;
}

export async function setPageCount(bookId: string, pages: number) {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };
  if (!isPremium(user)) return { success: false, error: PREMIUM_ONLY };
  const result = await setPageCountFor(user.userId, bookId, pages);
  if (result.success) revalidatePath("/stats");
  return result;
}
