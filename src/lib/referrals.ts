import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// Unambiguous charset: no 0/O, 1/I/l
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate a random 8-character referral code.
 * Uses only unambiguous characters (no 0/O, 1/I/l).
 */
function randomCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join("");
}

/**
 * Generate a unique referral code, retrying on collision.
 */
export async function generateReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  // Fallback: append random suffix
  return randomCode() + randomCode().slice(0, 2);
}

/**
 * Ensure a user has a referral code, generating one if needed.
 * Returns the user's referral code.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await db
    .select({ referralCode: users.referralCode })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (user?.referralCode) return user.referralCode;

  const code = await generateReferralCode();
  await db
    .update(users)
    .set({ referralCode: code })
    .where(eq(users.id, userId));

  return code;
}

/**
 * Look up a referrer by their referral code.
 * Returns the referrer's user ID and display info, or null if invalid.
 */
export async function lookupReferralCode(code: string): Promise<{
  userId: string;
  displayName: string | null;
  username: string | null;
} | null> {
  const referrer = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      username: users.username,
    })
    .from(users)
    .where(eq(users.referralCode, code.toUpperCase().trim()))
    .get();

  return referrer ?? null;
}

/**
 * Count how many users were referred by a given user.
 */
export async function getReferralCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(users)
    .where(eq(users.referredByUserId, userId));

  return result[0]?.count ?? 0;
}
