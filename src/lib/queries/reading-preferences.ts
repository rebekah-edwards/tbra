"use server";

import { db } from "@/db";
import {
  userReadingPreferences,
  userGenrePreferences,
  userContentPreferences,
  bookCategoryRatings,
  taxonomyCategories,
} from "@/db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { scanTextForCanonicals } from "@/lib/content-warnings/vocabulary";

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

export interface BookContentWarningMatches {
  /** Canonical warnings matched by reviewer-tagged custom warnings */
  tagMatches: { canonicalId: string; count: number }[];
  /** Canonical warnings matched by aliases appearing in admin-curated category notes */
  noteMatches: { canonicalId: string; categoryName: string }[];
}

/**
 * Find all matches for a user's "topics to avoid" list against a single book,
 * across BOTH evidence sources we have:
 *
 *   1. Reviewer-tagged custom warnings (review_descriptor_tags rows tagged
 *      `custom:{canonical_id}`).
 *   2. Admin-curated bookCategoryRatings notes — free-text notes describing
 *      what the rating covers, scanned for any alias of the user's avoid list
 *      via the in-memory canonical vocabulary.
 *
 * Both the prefs read and the data fetches happen in parallel where possible
 * to keep the book page's TTFB cost as small as it was before this feature
 * was added. Returns early with empty arrays if the user has no avoid list,
 * so this entire path is free for users who don't use it.
 */
export async function getBookContentWarningMatchesForUser(
  userId: string,
  bookId: string,
): Promise<BookContentWarningMatches> {
  // Pull the user's canonical avoid list — cheap single-row read.
  const prefsRow = await db
    .select({ customContentWarnings: userReadingPreferences.customContentWarnings })
    .from(userReadingPreferences)
    .where(eq(userReadingPreferences.userId, userId))
    .get();
  const avoid: string[] = prefsRow?.customContentWarnings
    ? JSON.parse(prefsRow.customContentWarnings)
    : [];
  if (avoid.length === 0) return { tagMatches: [], noteMatches: [] };

  // Run the two evidence-gathering queries in PARALLEL — same round trip cost
  // as the old single-query helper.
  const wantedTags = avoid.map((id) => `custom:${id}`);
  const [tagRows, noteRows] = await Promise.all([
    db.all<{ tag: string; count: number }>(sql`
      SELECT rdt.tag AS tag, COUNT(*) AS count
      FROM review_descriptor_tags rdt
      INNER JOIN user_book_reviews ubr ON rdt.review_id = ubr.id
      WHERE ubr.book_id = ${bookId}
        AND rdt.tag IN (${sql.join(wantedTags.map((t) => sql`${t}`), sql`, `)})
      GROUP BY rdt.tag
    `),
    db
      .select({
        notes: bookCategoryRatings.notes,
        categoryName: taxonomyCategories.name,
      })
      .from(bookCategoryRatings)
      .innerJoin(
        taxonomyCategories,
        eq(bookCategoryRatings.categoryId, taxonomyCategories.id),
      )
      .where(
        and(
          eq(bookCategoryRatings.bookId, bookId),
          isNotNull(bookCategoryRatings.notes),
        ),
      )
      .all(),
  ]);

  const tagMatches = tagRows.map((r) => ({
    canonicalId: r.tag.startsWith("custom:") ? r.tag.slice(7) : r.tag,
    count: r.count,
  }));

  // Scan each notes blob for any alias of the user's avoid list. Aliases live
  // in memory (vocabulary.ts), so this is O(notes_chars * num_aliases) with
  // no DB work. Dedupe by (canonicalId, categoryName) so we don't render the
  // same row twice if a notes blob mentions an alias multiple times.
  const seen = new Set<string>();
  const noteMatches: { canonicalId: string; categoryName: string }[] = [];
  for (const row of noteRows) {
    const hits = scanTextForCanonicals(row.notes, avoid);
    for (const canonicalId of hits) {
      const key = `${canonicalId}|${row.categoryName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      noteMatches.push({ canonicalId, categoryName: row.categoryName });
    }
  }

  return { tagMatches, noteMatches };
}

/**
 * @deprecated kept as a thin wrapper for back-compat — prefer
 * `getBookContentWarningMatchesForUser()` which returns both evidence sources.
 */
export async function getBookCustomWarningFlagsForUser(
  userId: string,
  bookId: string,
): Promise<{ canonicalId: string; count: number }[]> {
  const matches = await getBookContentWarningMatchesForUser(userId, bookId);
  return matches.tagMatches;
}

export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const row = await db
    .select({ completed: userReadingPreferences.onboardingCompleted })
    .from(userReadingPreferences)
    .where(eq(userReadingPreferences.userId, userId))
    .get();

  return row?.completed === 1;
}
