"use server";

import { db } from "@/db";
import {
  userReadingPreferences,
  userGenrePreferences,
  userContentPreferences,
} from "@/db/schema";
import { eq } from "drizzle-orm";

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

export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const row = await db
    .select({ completed: userReadingPreferences.onboardingCompleted })
    .from(userReadingPreferences)
    .where(eq(userReadingPreferences.userId, userId))
    .get();

  return row?.completed === 1;
}
