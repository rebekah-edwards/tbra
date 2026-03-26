"use server";

import { db } from "@/db";
import { readingGoals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export async function setReadingGoal(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  const targetStr = formData.get("targetBooks") as string;
  const target = parseInt(targetStr, 10);
  if (isNaN(target) || target < 1 || target > 500) {
    return { success: false, error: "Goal must be between 1 and 500 books" };
  }

  const year = new Date().getFullYear();

  const existing = await db.query.readingGoals.findFirst({
    where: and(eq(readingGoals.userId, session.userId), eq(readingGoals.year, year)),
  });

  if (existing) {
    await db
      .update(readingGoals)
      .set({ targetBooks: target, updatedAt: new Date().toISOString() })
      .where(eq(readingGoals.id, existing.id));
  } else {
    await db.insert(readingGoals).values({
      userId: session.userId,
      year,
      targetBooks: target,
    });
  }

  return { success: true };
}
