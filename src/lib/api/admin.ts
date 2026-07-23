import { getApiUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Bearer-auth twin of the web's `getCurrentUser().role === "admin"` gate —
 * v1 routes authenticate with the Authorization header, and the JWT doesn't
 * carry the role, so it's read from the users table.
 */
export async function requireApiAdmin(req: Request) {
  const user = await getApiUser(req);
  if (!user) return null;
  const row = await db.select({ role: users.role }).from(users).where(eq(users.id, user.userId)).get();
  return row?.role === "admin" ? user : null;
}

/**
 * Stricter gate for user management: the JWT carries neither role nor
 * accountType, so read accountType from the DB and require super_admin —
 * same bar as the web /admin/users page.
 */
export async function requireApiSuperAdmin(req: Request) {
  const user = await getApiUser(req);
  if (!user) return null;
  const row = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();
  return row?.accountType === "super_admin" ? user : null;
}
