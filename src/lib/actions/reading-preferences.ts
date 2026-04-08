"use server";

import { db } from "@/db";
import {
  userReadingPreferences,
  userGenrePreferences,
  userContentPreferences,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { canonicalizeWarning } from "@/lib/content-warnings/vocabulary";

/**
 * Canonicalize a list of user-entered content warnings.
 * Each raw entry is run through the vocabulary: a match returns the
 * canonical ID (stored so recommendations can compare exactly against
 * review tags), a miss returns the raw lowercased text (so the user
 * doesn't lose their entry). Duplicates are removed.
 */
function canonicalizeWarnings(raw: string[]): string[] {
  const out = new Set<string>();
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const canonical = canonicalizeWarning(trimmed);
    out.add(canonical ?? trimmed.toLowerCase());
  }
  return Array.from(out);
}

// ─── Types ───

export interface OnboardingData {
  fictionPreference: string | null;
  pageLengthMin: number | null;
  pageLengthMax: number | null;
  pacePreference: string | null; // JSON stringified array or single value for backwards compat
  moodPreferences: string[];
  storyFocus: string | null;
  characterTropes: string[]; // liked tropes
  dislikedTropes?: string[]; // disliked tropes (stored alongside characterTropes)
  customContentWarnings: string[];
  genrePreferences: { genreName: string; preference: "love" | "dislike" }[];
  contentPreferences: { categoryId: string; maxTolerance: number }[];
}

// ─── Onboarding bulk save ───

export async function saveOnboardingPreferences(
  data: OnboardingData
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  try {
    const canonicalWarnings = canonicalizeWarnings(data.customContentWarnings);

    // Upsert main preferences row
    await db.insert(userReadingPreferences)
      .values({
        userId: user.userId,
        fictionPreference: data.fictionPreference,
        pageLengthMin: data.pageLengthMin,
        pageLengthMax: data.pageLengthMax,
        pacePreference: data.pacePreference,
        moodPreferences: JSON.stringify(data.moodPreferences),
        storyFocus: data.storyFocus,
        characterTropes: JSON.stringify(data.characterTropes),
        dislikedTropes: JSON.stringify(data.dislikedTropes ?? []),
        customContentWarnings: JSON.stringify(canonicalWarnings),
        onboardingCompleted: 1,
      })
      .onConflictDoUpdate({
        target: userReadingPreferences.userId,
        set: {
          fictionPreference: data.fictionPreference,
          pageLengthMin: data.pageLengthMin,
          pageLengthMax: data.pageLengthMax,
          pacePreference: data.pacePreference,
          moodPreferences: JSON.stringify(data.moodPreferences),
          storyFocus: data.storyFocus,
          characterTropes: JSON.stringify(data.characterTropes),
          dislikedTropes: JSON.stringify(data.dislikedTropes ?? []),
          customContentWarnings: JSON.stringify(canonicalWarnings),
          onboardingCompleted: 1,
        },
      })
      .run();

    // Clear existing genre preferences and re-insert
    await db.delete(userGenrePreferences)
      .where(eq(userGenrePreferences.userId, user.userId))
      .run();

    for (const gp of data.genrePreferences) {
      await db.insert(userGenrePreferences)
        .values({
          userId: user.userId,
          genreName: gp.genreName,
          preference: gp.preference,
        })
        .run();
    }

    // Clear existing content preferences and re-insert
    await db.delete(userContentPreferences)
      .where(eq(userContentPreferences.userId, user.userId))
      .run();

    for (const cp of data.contentPreferences) {
      await db.insert(userContentPreferences)
        .values({
          userId: user.userId,
          categoryId: cp.categoryId,
          maxTolerance: cp.maxTolerance,
        })
        .run();
    }

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("Failed to save onboarding preferences:", err);
    return { success: false, error: "Failed to save preferences" };
  }
}

// ─── Individual updates (for settings page) ───

export async function updateReadingStyle(data: {
  fictionPreference?: string | null;
  pageLengthMin?: number | null;
  pageLengthMax?: number | null;
  pacePreference?: string | null;
  moodPreferences?: string[];
  storyFocus?: string | null;
  characterTropes?: string[];
  dislikedTropes?: string[];
  customContentWarnings?: string[];
}): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  try {
    const updateFields: Record<string, unknown> = {};
    if (data.fictionPreference !== undefined)
      updateFields.fictionPreference = data.fictionPreference;
    if (data.pageLengthMin !== undefined)
      updateFields.pageLengthMin = data.pageLengthMin;
    if (data.pageLengthMax !== undefined)
      updateFields.pageLengthMax = data.pageLengthMax;
    if (data.pacePreference !== undefined)
      updateFields.pacePreference = data.pacePreference;
    if (data.moodPreferences !== undefined)
      updateFields.moodPreferences = JSON.stringify(data.moodPreferences);
    if (data.storyFocus !== undefined)
      updateFields.storyFocus = data.storyFocus;
    if (data.characterTropes !== undefined)
      updateFields.characterTropes = JSON.stringify(data.characterTropes);
    if (data.dislikedTropes !== undefined)
      updateFields.dislikedTropes = JSON.stringify(data.dislikedTropes);
    if (data.customContentWarnings !== undefined)
      updateFields.customContentWarnings = JSON.stringify(canonicalizeWarnings(data.customContentWarnings));

    // Ensure row exists first
    await db.insert(userReadingPreferences)
      .values({ userId: user.userId, ...updateFields })
      .onConflictDoUpdate({
        target: userReadingPreferences.userId,
        set: updateFields,
      })
      .run();

    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    console.error("Failed to update reading style:", err);
    return { success: false, error: "Failed to update" };
  }
}

export async function updateGenrePreference(
  genreName: string,
  preference: "love" | "dislike" | null
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  try {
    if (preference === null) {
      // Remove preference
      await db.delete(userGenrePreferences)
        .where(
          and(
            eq(userGenrePreferences.userId, user.userId),
            eq(userGenrePreferences.genreName, genreName)
          )
        )
        .run();
    } else {
      // Upsert
      await db.insert(userGenrePreferences)
        .values({ userId: user.userId, genreName, preference })
        .onConflictDoUpdate({
          target: [
            userGenrePreferences.userId,
            userGenrePreferences.genreName,
          ],
          set: { preference },
        })
        .run();
    }

    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    console.error("Failed to update genre preference:", err);
    return { success: false };
  }
}

export async function updateContentPreference(
  categoryId: string,
  maxTolerance: number
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  try {
    await db.insert(userContentPreferences)
      .values({ userId: user.userId, categoryId, maxTolerance })
      .onConflictDoUpdate({
        target: [
          userContentPreferences.userId,
          userContentPreferences.categoryId,
        ],
        set: { maxTolerance },
      })
      .run();

    revalidatePath("/settings");
    // Invalidate recommendation caches so content preferences take effect
    const { revalidateTag } = await import("next/cache");
    revalidateTag(`user-${user.userId}-recommendations`);
    return { success: true };
  } catch (err) {
    console.error("Failed to update content preference:", err);
    return { success: false };
  }
}
