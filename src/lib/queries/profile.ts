import { db } from "@/db";
import { parseFormats } from "@/lib/reading-formats";
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
  /** Up to 3 cover URLs per pile, most recently touched first. */
  covers: { completed: string[]; currentlyReading: string[]; tbr: string[] };
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
    if (parseFormats(row.ownedFormats).length > 0) owned++;
  }

  const covers = await getStatCovers(userId);
  return { completed, currentlyReading, tbr, owned, covers };
}

/** Up to three covers per pile, newest-touched first — the art the profile's
 *  Read / Reading / TBR cards are built from (2026-11 refresh). One query:
 *  a window over the reader's own rows, which the (user_id, book_id) unique
 *  index already narrows. */
async function getStatCovers(userId: string): Promise<UserStats["covers"]> {
  const rows = (await db.all(sql`
    SELECT state, cover FROM (
      SELECT ubs.state AS state,
             b.cover_image_url AS cover,
             ROW_NUMBER() OVER (PARTITION BY ubs.state ORDER BY ubs.updated_at DESC) AS rn
      FROM user_book_state ubs
      JOIN books b ON b.id = ubs.book_id
      WHERE ubs.user_id = ${userId}
        AND ubs.state IN ('completed', 'currently_reading', 'tbr')
        AND b.cover_image_url IS NOT NULL AND b.cover_image_url != ''
        AND COALESCE(b.visibility, 'public') != 'hidden'
    ) WHERE rn <= 3
    ORDER BY state, rn
  `)) as { state: string; cover: string }[];

  const covers: UserStats["covers"] = { completed: [], currentlyReading: [], tbr: [] };
  for (const r of rows) {
    if (r.state === "completed") covers.completed.push(r.cover);
    else if (r.state === "currently_reading") covers.currentlyReading.push(r.cover);
    else if (r.state === "tbr") covers.tbr.push(r.cover);
  }
  return covers;
}
