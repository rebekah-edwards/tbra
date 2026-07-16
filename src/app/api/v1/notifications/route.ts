import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { db } from "@/db";
import { userNotifications } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

/** GET /api/v1/notifications — latest 20, same query as the web bell. */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const notifications = await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, user.userId))
    .orderBy(desc(userNotifications.createdAt))
    .limit(20);

  return jsonOk({ notifications });
}

/** PATCH /api/v1/notifications — { id } or { markAllRead: true }. */
export async function PATCH(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  if (body.markAllRead === true) {
    await db
      .update(userNotifications)
      .set({ read: true })
      .where(and(eq(userNotifications.userId, user.userId), eq(userNotifications.read, false)));
    return jsonOk({});
  }
  if (typeof body.id === "string") {
    await db
      .update(userNotifications)
      .set({ read: true })
      .where(and(eq(userNotifications.id, body.id), eq(userNotifications.userId, user.userId)));
    return jsonOk({});
  }
  return jsonError("Bad request.", 400);
}
