import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { userNotifications } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const notifications = await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, user.userId))
    .orderBy(desc(userNotifications.createdAt))
    .limit(20);

  return Response.json(notifications);
}

/** Mark a notification as read */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json();
  const { id, markAllRead } = body;

  if (markAllRead) {
    await db
      .update(userNotifications)
      .set({ read: true })
      .where(and(eq(userNotifications.userId, user.userId), eq(userNotifications.read, false)));
    return Response.json({ ok: true });
  }

  if (id) {
    await db
      .update(userNotifications)
      .set({ read: true })
      .where(and(eq(userNotifications.id, id), eq(userNotifications.userId, user.userId)));
    return Response.json({ ok: true });
  }

  return new Response("Bad request", { status: 400 });
}
