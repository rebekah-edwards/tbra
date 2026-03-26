import { db } from "@/db";
import { readingGoals, readingSessions } from "@/db/schema";
import { eq, and, like, sql, isNotNull } from "drizzle-orm";

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

  // Count unique completed books in this year (not sessions — re-imports can create duplicates)
  // Only count books with real completion dates (exclude synthetic import dates)
  const completedRows = await db
    .select({ count: sql<number>`count(DISTINCT ${readingSessions.bookId})` })
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        eq(readingSessions.state, "completed"),
        like(readingSessions.completionDate, `${year}-%`),
        isNotNull(readingSessions.completionPrecision)
      )
    )
    .get();

  const completedBooks = completedRows?.count ?? 0;
  const percentComplete = goal.targetBooks > 0
    ? Math.min(100, Math.round((completedBooks / goal.targetBooks) * 100))
    : 0;

  return {
    targetBooks: goal.targetBooks,
    completedBooks,
    percentComplete,
  };
}
