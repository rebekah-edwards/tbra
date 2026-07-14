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
