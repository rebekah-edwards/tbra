import { db } from "@/db";
import { userBookState } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface ReadingStats {
  currentlyReading: number;
  tbr: number;
  completed: number;
  totalBooks: number;
}

export async function getReadingStats(userId: string): Promise<ReadingStats> {
  const rows = await db
    .select({ state: userBookState.state })
    .from(userBookState)
    .where(eq(userBookState.userId, userId));

  let currentlyReading = 0;
  let tbr = 0;
  let completed = 0;

  for (const row of rows) {
    if (row.state === "currently_reading") currentlyReading++;
    else if (row.state === "tbr") tbr++;
    else if (row.state === "completed") completed++;
  }

  return {
    currentlyReading,
    tbr,
    completed,
    totalBooks: rows.length,
  };
}
