import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { db } from "@/db";
import { taxonomyCategories, userContentPreferences, userReadingPreferences, userNotificationPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserReadingPreferences } from "@/lib/queries/reading-preferences";
import { getNotificationPreferences } from "@/lib/actions/notification-preferences";
import { getHiddenBooks } from "@/lib/actions/hidden-books";
import { canonicalizeWarning } from "@/lib/content-warnings/vocabulary";

/** Same canonicalization as the web's updateReadingStyle helper. */
function canonicalizeWarnings(raw: string[]): string[] {
  const out = new Set<string>();
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    out.add(canonicalizeWarning(trimmed) ?? trimmed.toLowerCase());
  }
  return [...out];
}

/**
 * GET /api/v1/settings — the settings page payload: content comfort zone
 * (all active categories joined with the user's tolerances), custom
 * topics-to-avoid, notification prefs, hidden books.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const [prefs, notifPrefs, hiddenBooks, activeCategoriesRaw] = await Promise.all([
    getUserReadingPreferences(user.userId),
    getNotificationPreferences(user.userId),
    getHiddenBooks(user.userId),
    db
      .select({ id: taxonomyCategories.id, key: taxonomyCategories.key, name: taxonomyCategories.name })
      .from(taxonomyCategories)
      .where(eq(taxonomyCategories.active, true))
      .all(),
  ]);

  // Same "Other" exclusion + sort as the web settings page
  const activeCategories = activeCategoriesRaw
    .filter((c) => c.key !== "other")
    .sort((a, b) => a.name.localeCompare(b.name));

  const toleranceById = new Map(
    (prefs?.contentPreferences ?? []).map((cp) => [cp.categoryId, cp.maxTolerance])
  );

  return jsonOk({
    contentPrefs: activeCategories.map((c) => ({
      categoryId: c.id,
      key: c.key,
      name: c.name,
      maxTolerance: toleranceById.get(c.id) ?? 4,
    })),
    customWarnings: prefs?.customContentWarnings ?? [],
    notificationPrefs: notifPrefs,
    hiddenBooks,
  });
}

/**
 * PATCH /api/v1/settings — one of:
 *  { categoryId, maxTolerance }             (content comfort zone)
 *  { customWarnings: string[] }             (topics to avoid, canonicalized)
 *  { notifications: { emailNewFollower?, emailNewCorrection?, emailWeeklyDigest? } }
 * Same writes as the web actions.
 */
export async function PATCH(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  if (typeof body.categoryId === "string" && typeof body.maxTolerance === "number") {
    const tolerance = Math.max(0, Math.min(4, Math.round(body.maxTolerance)));
    await db.insert(userContentPreferences)
      .values({ userId: user.userId, categoryId: body.categoryId, maxTolerance: tolerance })
      .onConflictDoUpdate({
        target: [userContentPreferences.userId, userContentPreferences.categoryId],
        set: { maxTolerance: tolerance },
      })
      .run();
    return jsonOk({});
  }

  if (Array.isArray(body.customWarnings)) {
    const warnings = canonicalizeWarnings(
      body.customWarnings.filter((w: unknown): w is string => typeof w === "string")
    );
    const fields = { customContentWarnings: JSON.stringify(warnings) };
    await db.insert(userReadingPreferences)
      .values({ userId: user.userId, ...fields })
      .onConflictDoUpdate({ target: userReadingPreferences.userId, set: fields })
      .run();
    return jsonOk({ customWarnings: warnings });
  }

  if (body.notifications && typeof body.notifications === "object") {
    const allowed = ["emailNewFollower", "emailNewCorrection", "emailWeeklyDigest"] as const;
    const prefs: Record<string, boolean> = {};
    for (const key of allowed) {
      if (typeof body.notifications[key] === "boolean") prefs[key] = body.notifications[key];
    }
    if (Object.keys(prefs).length === 0) return jsonError("No valid notification keys.", 400);
    const now = new Date().toISOString();
    const existing = await db.query.userNotificationPreferences.findFirst({
      where: eq(userNotificationPreferences.userId, user.userId),
    });
    if (existing) {
      await db.update(userNotificationPreferences)
        .set({ ...prefs, updatedAt: now })
        .where(eq(userNotificationPreferences.userId, user.userId));
    } else {
      await db.insert(userNotificationPreferences).values({
        userId: user.userId,
        emailNewFollower: prefs.emailNewFollower ?? true,
        emailNewCorrection: prefs.emailNewCorrection ?? true,
        emailWeeklyDigest: prefs.emailWeeklyDigest ?? false,
        updatedAt: now,
      });
    }
    return jsonOk({});
  }

  return jsonError("Unrecognized settings patch.", 400);
}
