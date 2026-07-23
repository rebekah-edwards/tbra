"use server";

import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import type { AccountType } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { followUserFor, unfollowUserFor } from "@/lib/actions/follows";

const VALID_ACCOUNT_TYPES: AccountType[] = [
  "reader",
  "premium",
  "beta_tester",
  "admin",
  "super_admin",
];

export async function updateUserAccountType(
  targetUserId: string,
  newAccountType: string
): Promise<{ success: boolean; error?: string }> {
  const currentUser = await getCurrentUser();

  if (!currentUser || !isSuperAdmin(currentUser)) {
    return { success: false, error: "Unauthorized" };
  }

  // Safety: cannot demote yourself
  if (targetUserId === currentUser.userId) {
    return { success: false, error: "Cannot change your own account type" };
  }

  if (!VALID_ACCOUNT_TYPES.includes(newAccountType as AccountType)) {
    return { success: false, error: "Invalid account type" };
  }

  await db
    .update(users)
    .set({
      accountType: newAccountType,
      // The Admin Edit panel requires BOTH account_type AND role='admin' —
      // keep role in sync so tier changes fully take effect.
      role: ["admin", "super_admin"].includes(newAccountType) ? "admin" : "user",
    })
    .where(eq(users.id, targetUserId));

  return { success: true };
}

/** Follow/unfollow from the admin user list (any signed-in user; follow-by-id
 *  so accounts without a username still work). */
export async function setUserFollow(
  targetUserId: string,
  follow: boolean
): Promise<{ success: boolean; error?: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { success: false, error: "Unauthorized" };
  return follow
    ? followUserFor(currentUser.userId, targetUserId)
    : unfollowUserFor(currentUser.userId, targetUserId);
}
