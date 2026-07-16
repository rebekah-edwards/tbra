import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { db } from "@/db";
import { taxonomyCategories, userContentPreferences, userReadingPreferences, userNotificationPreferences, userGenrePreferences, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserReadingPreferences } from "@/lib/queries/reading-preferences";
import { getNotificationPreferences } from "@/lib/actions/notification-preferences";
import { getHiddenBooks } from "@/lib/actions/hidden-books";
import { canonicalizeWarning } from "@/lib/content-warnings/vocabulary";

/** JSON-array column → string[]; legacy single value → [value]; null → []. */
function parseMaybeArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [String(parsed)];
  } catch {
    return [raw];
  }
}

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

  const [prefs, notifPrefs, hiddenBooks, activeCategoriesRaw, genreRows, userRow, rawPrefs] = await Promise.all([
    getUserReadingPreferences(user.userId),
    getNotificationPreferences(user.userId),
    getHiddenBooks(user.userId),
    db
      .select({ id: taxonomyCategories.id, key: taxonomyCategories.key, name: taxonomyCategories.name })
      .from(taxonomyCategories)
      .where(eq(taxonomyCategories.active, true))
      .all(),
    db.select({ genreName: userGenrePreferences.genreName, preference: userGenrePreferences.preference })
      .from(userGenrePreferences).where(eq(userGenrePreferences.userId, user.userId)).all(),
    db.select({ email: users.email, location: users.location, locationVisibility: users.locationVisibility })
      .from(users).where(eq(users.id, user.userId)).get(),
    // Raw row: getUserReadingPreferences doesn't expose textSize and returns
    // pacePreference unparsed — normalize everything here for the app.
    db.select().from(userReadingPreferences)
      .where(eq(userReadingPreferences.userId, user.userId)).get(),
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
    // Full settings-page payload (2026-07-16, native settings parity).
    // Arrays normalized: pace_preference may be a JSON array OR a legacy
    // single value; moods/tropes are JSON arrays or null.
    genrePrefs: genreRows,
    readingStyle: {
      fictionPreference: rawPrefs?.fictionPreference ?? null,
      pacePreference: parseMaybeArray(rawPrefs?.pacePreference),
      pageLengthMin: rawPrefs?.pageLengthMin ?? null,
      pageLengthMax: rawPrefs?.pageLengthMax ?? null,
      moodPreferences: parseMaybeArray(rawPrefs?.moodPreferences),
      storyFocus: rawPrefs?.storyFocus ?? null,
      characterTropes: parseMaybeArray(rawPrefs?.characterTropes),
      dislikedTropes: parseMaybeArray(rawPrefs?.dislikedTropes),
      textSize: rawPrefs?.textSize ?? null,
      hasPrefsRow: rawPrefs != null,
    },
    location: userRow?.location ?? "",
    locationVisibility: userRow?.locationVisibility ?? "public",
    email: userRow?.email ?? "",
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
      .values({ userId: user.userId, categoryId: body.categoryId, maxTolerance: tolerance, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [userContentPreferences.userId, userContentPreferences.categoryId],
        set: { maxTolerance: tolerance, updatedAt: new Date().toISOString() },
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

  // { genreName, preference: "love" | "dislike" | null } — tri-state chip
  // (mirrors web updateGenrePreference: null deletes the row).
  if (typeof body.genreName === "string" && "preference" in body) {
    const pref = body.preference;
    if (pref !== "love" && pref !== "dislike" && pref !== null) {
      return jsonError("preference must be 'love', 'dislike', or null.", 400);
    }
    if (pref === null) {
      await db.delete(userGenrePreferences).where(and(
        eq(userGenrePreferences.userId, user.userId),
        eq(userGenrePreferences.genreName, body.genreName),
      ));
    } else {
      await db.insert(userGenrePreferences)
        .values({ userId: user.userId, genreName: body.genreName, preference: pref })
        .onConflictDoUpdate({
          target: [userGenrePreferences.userId, userGenrePreferences.genreName],
          set: { preference: pref },
        })
        .run();
    }
    return jsonOk({});
  }

  // { readingStyle: { …partial } } — mirrors web updateReadingStyle: arrays
  // stored as JSON strings, null clears, single-row upsert.
  if (body.readingStyle && typeof body.readingStyle === "object") {
    const rs = body.readingStyle;
    const fields: Record<string, string | number | null> = {};
    if ("fictionPreference" in rs) fields.fictionPreference = rs.fictionPreference ?? null;
    if ("storyFocus" in rs) fields.storyFocus = rs.storyFocus ?? null;
    if ("textSize" in rs) fields.textSize = rs.textSize ?? null;
    if ("pageLengthMin" in rs) fields.pageLengthMin = rs.pageLengthMin ?? null;
    if ("pageLengthMax" in rs) fields.pageLengthMax = rs.pageLengthMax ?? null;
    for (const key of ["pacePreference", "moodPreferences", "characterTropes", "dislikedTropes"] as const) {
      if (key in rs) {
        const v = rs[key];
        fields[key] = Array.isArray(v) && v.length > 0 ? JSON.stringify(v) : null;
      }
    }
    if (Object.keys(fields).length === 0) return jsonError("No reading-style fields.", 400);
    await db.insert(userReadingPreferences)
      .values({ userId: user.userId, ...fields })
      .onConflictDoUpdate({ target: userReadingPreferences.userId, set: fields })
      .run();
    return jsonOk({});
  }

  // { location: { location, locationVisibility } } — users columns, same
  // validation as /api/user-preferences/location.
  if (body.location && typeof body.location === "object") {
    const loc = typeof body.location.location === "string" ? body.location.location.slice(0, 100).trim() : "";
    const vis = body.location.locationVisibility === "followers" ? "followers" : "public";
    await db.update(users)
      .set({ location: loc || null, locationVisibility: vis, updatedAt: new Date().toISOString() })
      .where(eq(users.id, user.userId));
    return jsonOk({});
  }

  return jsonError("Unrecognized settings patch.", 400);
}
