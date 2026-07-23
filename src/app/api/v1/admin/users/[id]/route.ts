import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiSuperAdmin } from "@/lib/api/admin";
import { followUserFor, unfollowUserFor } from "@/lib/actions/follows";
import type { AccountType } from "@/lib/auth";

const VALID_ACCOUNT_TYPES: AccountType[] = [
  "reader",
  "premium",
  "beta_tester",
  "admin",
  "super_admin",
];

/**
 * PATCH /api/v1/admin/users/[id] — two operations for the native user
 * management screen (super-admin only):
 *   { accountType } — change the target's tier (role kept in sync: the
 *     Admin Edit panel requires BOTH account_type and role='admin')
 *   { follow: true|false } — follow/unfollow the target as the admin
 *     (follow-by-id, so accounts without a username still work)
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireApiSuperAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);
  const { id } = await ctx.params;
  const body = await parseJsonBody(req);

  if (typeof body?.follow === "boolean") {
    const result = body.follow
      ? await followUserFor(admin.userId, id)
      : await unfollowUserFor(admin.userId, id);
    if (!result.success) return jsonError(result.error ?? "Couldn't update follow.", 400);
    return jsonOk({ following: body.follow });
  }

  const newType = body?.accountType;
  if (typeof newType !== "string") return jsonError("accountType or follow required.", 400);
  if (id === admin.userId) return jsonError("Cannot change your own account type.", 400);
  if (!VALID_ACCOUNT_TYPES.includes(newType as AccountType)) {
    return jsonError("Invalid account type.", 400);
  }

  const target = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
  if (!target) return jsonError("User not found.", 404);

  await db
    .update(users)
    .set({
      accountType: newType,
      role: ["admin", "super_admin"].includes(newType) ? "admin" : "user",
    })
    .where(eq(users.id, id));

  return jsonOk({ accountType: newType });
}
