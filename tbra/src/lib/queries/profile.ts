import { db } from "@/db";
import { users, userBookState } from "@/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export async function getUser(userId: string): Promise<UserProfile | null> {
  const row = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return row ?? null;
}

export interface UserStats {
  completed: number;
  currentlyReading: number;
  tbr: number;
  owned: number;
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const rows = await db
    .select({
      state: userBookState.state,
      ownedFormats: userBookState.ownedFormats,
    })
    .from(userBookState)
    .where(eq(userBookState.userId, userId))
    .all();

  let completed = 0;
  let currentlyReading = 0;
  let tbr = 0;
  let owned = 0;

  for (const row of rows) {
    if (row.state === "completed") completed++;
    if (row.state === "currently_reading") currentlyReading++;
    if (row.state === "tbr") tbr++;
    if (row.ownedFormats) {
      const formats = JSON.parse(row.ownedFormats) as string[];
      if (formats.length > 0) owned++;
    }
  }

  return { completed, currentlyReading, tbr, owned };
}
