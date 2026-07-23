import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { updateProfileFor } from "@/lib/mutations/profile";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * PATCH /api/v1/profile/update — the native Edit Profile screen. Same
 * fields + validation as the web /profile/edit form (shared core in
 * mutations/profile.ts): displayName, username (30-day change limit),
 * bio, social handles, isPrivate.
 */
export async function PATCH(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const result = await updateProfileFor(user.userId, {
    displayName: s(body.displayName),
    username: s(body.username),
    bio: s(body.bio),
    instagram: s(body.instagram),
    tiktok: s(body.tiktok),
    threads: s(body.threads),
    twitter: s(body.twitter),
    isPrivate: body.isPrivate === true,
  });
  if (!result.success) return jsonError(result.error ?? "Couldn't save profile.", 400);

  const row = await db
    .select({ username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, user.userId))
    .get();
  return jsonOk({ username: row?.username ?? null, displayName: row?.displayName ?? null });
}
