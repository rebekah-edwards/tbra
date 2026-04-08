"use server";

import { db } from "@/db";
import {
  userReadingPreferences,
  userGenrePreferences,
  userContentPreferences,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export interface ReadingPreferencesData {
  fictionPreference: string | null;
  pageLengthMin: number | null;
  pageLengthMax: number | null;
  pacePreference: string | null; // JSON array string or single value
  moodPreferences: string[];
  storyFocus: string | null;
  characterTropes: string[];
  dislikedTropes: string[];
  customContentWarnings: string[];
  onboardingCompleted: boolean;
  genrePreferences: { genreName: string; preference: string }[];
  contentPreferences: { categoryId: string; maxTolerance: number }[];
}

export async function getUserReadingPreferences(
  userId: string
): Promise<ReadingPreferencesData | null> {
  const prefs = await db
    .select()
    .from(userReadingPreferences)
    .where(eq(userReadingPreferences.userId, userId))
    .get();

  if (!prefs) return null;

  const genrePrefs = await db
    .select({
      genreName: userGenrePreferences.genreName,
      preference: userGenrePreferences.preference,
    })
    .from(userGenrePreferences)
    .where(eq(userGenrePreferences.userId, userId))
    .all();

  const contentPrefs = await db
    .select({
      categoryId: userContentPreferences.categoryId,
      maxTolerance: userContentPreferences.maxTolerance,
    })
    .from(userContentPreferences)
    .where(eq(userContentPreferences.userId, userId))
    .all();

  return {
    fictionPreference: prefs.fictionPreference,
    pageLengthMin: prefs.pageLengthMin,
    pageLengthMax: prefs.pageLengthMax,
    pacePreference: prefs.pacePreference,
    moodPreferences: prefs.moodPreferences
      ? JSON.parse(prefs.moodPreferences)
      : [],
    storyFocus: prefs.storyFocus ?? null,
    characterTropes: prefs.characterTropes
      ? JSON.parse(prefs.characterTropes)
      : [],
    dislikedTropes: prefs.dislikedTropes
      ? JSON.parse(prefs.dislikedTropes)
      : [],
    customContentWarnings: prefs.customContentWarnings
      ? JSON.parse(prefs.customContentWarnings)
      : [],
    onboardingCompleted: prefs.onboardingCompleted === 1,
    genrePreferences: genrePrefs,
    contentPreferences: contentPrefs,
  };
}

export async function getUserContentSensitivities(
  userId: string
): Promise<{
  contentPreferences: { categoryId: string; maxTolerance: number }[];
  customContentWarnings: string[];
} | null> {
  const prefs = await db
    .select({
      customContentWarnings: userReadingPreferences.customContentWarnings,
    })
    .from(userReadingPreferences)
    .where(eq(userReadingPreferences.userId, userId))
    .get();

  if (!prefs) return null;

  const contentPrefs = await db
    .select({
      categoryId: userContentPreferences.categoryId,
      maxTolerance: userContentPreferences.maxTolerance,
    })
    .from(userContentPreferences)
    .where(eq(userContentPreferences.userId, userId))
    .all();

  return {
    contentPreferences: contentPrefs,
    customContentWarnings: prefs.customContentWarnings
      ? JSON.parse(prefs.customContentWarnings)
      : [],
  };
}

/**
 * Count how many reviews for a single book have flagged each canonical
 * custom warning the user asked to avoid. Returns a list of matches —
 * empty if the user has no custom warnings OR none of them are present
 * on the book's reviews.
 *
 * Called from the book page alongside other data fetches, so it runs in
 * parallel with them inside the `Promise.all`. One query, filtered by
 * bookId + tag IN (...), grouped by tag. Zero work for users who haven't
 * set any topics to avoid.
 */
export async function getBookCustomWarningFlagsForUser(
  userId: string,
  bookId: string,
): Promise<{ canonicalId: string; count: number }[]> {
  // Pull the user's canonical avoid list inline — cheap single-row read.
  const prefsRow = await db
    .select({ customContentWarnings: userReadingPreferences.customContentWarnings })
    .from(userReadingPreferences)
    .where(eq(userReadingPreferences.userId, userId))
    .get();
  const avoid: string[] = prefsRow?.customContentWarnings
    ? JSON.parse(prefsRow.customContentWarnings)
    : [];
  if (avoid.length === 0) return [];

  const wantedTags = avoid.map((id) => `custom:${id}`);
  const rows = await db.all<{ tag: string; count: number }>(sql`
    SELECT rdt.tag AS tag, COUNT(*) AS count
    FROM review_descriptor_tags rdt
    INNER JOIN user_book_reviews ubr ON rdt.review_id = ubr.id
    WHERE ubr.book_id = ${bookId}
      AND rdt.tag IN (${sql.join(wantedTags.map((t) => sql`${t}`), sql`, `)})
    GROUP BY rdt.tag
  `);

  return rows.map((r) => ({
    canonicalId: r.tag.startsWith("custom:") ? r.tag.slice(7) : r.tag,
    count: r.count,
  }));
}

export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const row = await db
    .select({ completed: userReadingPreferences.onboardingCompleted })
    .from(userReadingPreferences)
    .where(eq(userReadingPreferences.userId, userId))
    .get();

  return row?.completed === 1;
}
