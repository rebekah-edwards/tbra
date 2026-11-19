import { db } from "@/db";
import { readingGoals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getYearReads } from "./year-reads";

export interface ReadingGoalProgress {
  targetBooks: number;
  completedBooks: number;
  percentComplete: number;
}

export async function getReadingGoal(
  userId: string,
  year: number
): Promise<ReadingGoalProgress | null> {
  const goal = await db.query.readingGoals.findFirst({
    where: and(eq(readingGoals.userId, userId), eq(readingGoals.year, year)),
  });

  if (!goal) return null;

  // Distinct READS finished this year, re-reads included; near-duplicate
  // import sessions for one read collapse (see year-reads.ts).
  const completedBooks = (await getYearReads(userId, year)).length;
  const percentComplete = goal.targetBooks > 0
    ? Math.min(100, Math.round((completedBooks / goal.targetBooks) * 100))
    : 0;

  return {
    targetBooks: goal.targetBooks,
    completedBooks,
    percentComplete,
  };
}
