import { db } from "@/db";
import { readingGoals } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * User-scoped core of the setReadingGoal server action — identical validation
 * and writes, shared by the web action and /api/v1/reading-goal.
 */
export async function setReadingGoalFor(
  userId: string,
  target: number
): Promise<{ success: boolean; error?: string }> {
  if (isNaN(target) || target < 1 || target > 500) {
    return { success: false, error: "Goal must be between 1 and 500 books" };
  }

  const year = new Date().getFullYear();

  const existing = await db.query.readingGoals.findFirst({
    where: and(eq(readingGoals.userId, userId), eq(readingGoals.year, year)),
  });

  if (existing) {
    await db
      .update(readingGoals)
      .set({ targetBooks: target, updatedAt: new Date().toISOString() })
      .where(eq(readingGoals.id, existing.id));
  } else {
    await db.insert(readingGoals).values({
      userId,
      year,
      targetBooks: target,
    });
  }

  return { success: true };
}
