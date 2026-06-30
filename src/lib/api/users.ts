import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * The user shape returned by the native (`/api/v1`) auth endpoints.
 * Deliberately excludes sensitive columns (passwordHash, verification/reset
 * tokens, googleSub, etc.) — only safe, app-facing profile fields.
 */
export interface PublicUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  accountType: string;
  emailVerified: boolean;
}

type UserRow = typeof users.$inferSelect;

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    accountType: row.accountType,
    emailVerified: row.emailVerified,
  };
}

export async function fetchPublicUser(userId: string): Promise<PublicUser | null> {
  const row = await db.select().from(users).where(eq(users.id, userId)).get();
  return row ? toPublicUser(row) : null;
}
