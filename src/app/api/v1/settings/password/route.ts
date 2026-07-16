import { getApiUser, hashPassword, verifyPassword } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/v1/settings/password — bearer twin of the web changePassword
 * action (src/lib/actions/auth.ts): same validation order and messages.
 * Body: { currentPassword, newPassword, confirmNewPassword }
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const { currentPassword, newPassword, confirmNewPassword } = body;

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return jsonError("All fields are required.", 400);
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return jsonError("New password must be at least 8 characters.", 400);
  }
  if (newPassword !== confirmNewPassword) {
    return jsonError("New passwords don't match.", 400);
  }

  const row = await db.select({ passwordHash: users.passwordHash })
    .from(users).where(eq(users.id, user.userId)).get();
  if (!row?.passwordHash || !(await verifyPassword(currentPassword, row.passwordHash))) {
    return jsonError("Current password is incorrect.", 400);
  }

  await db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.userId));
  return jsonOk({});
}
