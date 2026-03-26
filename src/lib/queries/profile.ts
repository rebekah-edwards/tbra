import { db } from "@/db";
import { users, userBookState } from "@/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  instagram: string | null;
  tiktok: string | null;
  threads: string | null;
  twitter: string | null;
  location: string | null;
  locationVisibility: string | null;
  isPrivate: boolean;
  accountType: string;
  createdAt: string;
}

const userProfileSelect = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  username: users.username,
  avatarUrl: users.avatarUrl,
  bio: users.bio,
  instagram: users.instagram,
  tiktok: users.tiktok,
  threads: users.threads,
  twitter: users.twitter,
  location: users.location,
  locationVisibility: users.locationVisibility,
  isPrivate: users.isPrivate,
  accountType: users.accountType,
  createdAt: users.createdAt,
};

export async function getUser(userId: string): Promise<UserProfile | null> {
  const row = await db
    .select(userProfileSelect)
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return row ?? null;
}

export async function getUserByUsername(username: string): Promise<UserProfile | null> {
  const row = await db
    .select(userProfileSelect)
    .from(users)
    .where(eq(users.username, username))
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
