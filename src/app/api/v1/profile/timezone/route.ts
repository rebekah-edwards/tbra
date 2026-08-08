import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody, asString } from "@/lib/api/http";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/v1/profile/timezone  { timezone: "America/Chicago" }
 *
 * Clients report their IANA zone after sign-in so reading streaks bucket days
 * in the reader's own calendar. Cheap and idempotent: skips the write when it
 * already matches. Serves web (cookie) and native (bearer) — getApiUser
 * handles both.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const timezone = body ? asString(body.timezone)?.trim() : null;
  if (!timezone) return jsonError("timezone is required.", 400);

  // Validate against the runtime's own tz database — never store junk that
  // would throw when the streak query formats with it.
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  } catch {
    return jsonError("Unrecognized timezone.", 400);
  }

  const current = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();

  if (current?.timezone === timezone) return jsonOk({ timezone, changed: false });

  await db.update(users).set({ timezone }).where(eq(users.id, user.userId));
  return jsonOk({ timezone, changed: true });
}
