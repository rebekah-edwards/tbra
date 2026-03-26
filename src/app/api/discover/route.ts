import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDiscoverRecommendations, type DiscoverFilters } from "@/lib/queries/recommendations";
import { getMoodFilters } from "@/lib/mood-genre-map";

/**
 * POST /api/discover
 *
 * Body: {
 *   moods?: string[],
 *   length?: "short" | "medium" | "long",
 *   fictionFilter?: "fiction" | "nonfiction" | "both",
 *   audience?: "adult" | "ya" | "any",
 *   contentOverrides?: Record<string, number>
 * }
 *
 * Returns personalized book recommendations filtered by mood, length, and content preferences.
 * Works for both logged-in and anonymous users (anonymous gets generic results).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json();

  const moods: string[] = body.moods ?? [];
  const length: "short" | "medium" | "long" | null = body.length ?? null;
  const fictionFilter: "fiction" | "nonfiction" | "both" | null = body.fictionFilter ?? null;
  const audience: "adult" | "ya" | "teen" | "mg" | "any" | null = body.audience ?? null;
  const libraryFilter: "tbr" | "owned" | null = body.libraryFilter ?? null;
  const seriesStartersOnly: boolean = body.seriesStartersOnly ?? false;
  const contentOverrides: Record<string, number> | undefined = body.contentOverrides;
  const ignorePreferences: boolean = body.ignorePreferences ?? false;

  // Convert moods to genre filters
  const moodFilters = getMoodFilters(moods);

  // Determine fiction bias: explicit filter takes priority over mood-derived bias
  let fictionBias: "fiction" | "nonfiction" | null = moodFilters?.fictionBias ?? null;
  if (fictionFilter === "fiction") fictionBias = "fiction";
  else if (fictionFilter === "nonfiction") fictionBias = "nonfiction";
  else if (fictionFilter === "both") fictionBias = null;

  const filters: DiscoverFilters = {
    boostKeywords: moodFilters?.boostKeywords ?? [],
    penaltyKeywords: moodFilters?.penaltyKeywords ?? [],
    contentMaxima: {
      ...(moodFilters?.contentMaxima ?? {}),
      ...(contentOverrides ?? {}),
    },
    fictionBias,
    lengthPreference: length,
    audience: audience === "any" ? null : audience ?? null,
    libraryFilter,
    seriesStartersOnly,
    ignorePreferences,
  };

  const results = await getDiscoverRecommendations(
    user?.userId ?? null,
    filters,
    12
  );

  return NextResponse.json(results);
}
