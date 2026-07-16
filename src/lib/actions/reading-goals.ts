"use server";

import { getCurrentUser } from "@/lib/auth";
import { setReadingGoalFor } from "@/lib/mutations/reading-goals";

export async function setReadingGoal(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  // Shared user-scoped implementation (also used by /api/v1) — see
  // src/lib/mutations/reading-goals.ts. Validation + writes are the exact
  // former body of this action.
  const target = parseInt(formData.get("targetBooks") as string, 10);
  return setReadingGoalFor(session.userId, target);
}
