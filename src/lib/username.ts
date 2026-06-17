import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Auto-generate a unique username from an email prefix.
 * Returns null if a clean username can't be derived (caller proceeds without
 * one; the user can set it later). Shared by email signup + Google sign-in.
 */
export async function generateUniqueUsername(email: string): Promise<string | null> {
  try {
    const emailPrefix = email.toLowerCase().split("@")[0].replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (emailPrefix.length < 3) return null;

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, emailPrefix)).get();
    if (!existing) return emailPrefix;

    // Try a few random numeric suffixes.
    for (let i = 0; i < 5; i++) {
      const candidate = `${emailPrefix.slice(0, 17)}${Math.floor(100 + Math.random() * 900)}`;
      const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, candidate)).get();
      if (!taken) return candidate;
    }
  } catch {
    // fall through — username is optional
  }
  return null;
}
