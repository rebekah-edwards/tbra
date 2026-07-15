import { NextResponse } from "next/server";
import { getCurrentUser, isPremium } from "@/lib/auth";
import { consumeDiscoverSearch, FREE_DISCOVER_SEARCHES_PER_MONTH } from "@/lib/discover-quota";
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
 * Premium-only (Based Reader tier) — the /discover page shows the upgrade
 * prompt to everyone else, so a 403 here is a belt-and-suspenders backstop.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to use Find My Next Read." }, { status: 401 });
  }
  // Free tier: 3 searches/month; Based Reader: unlimited (remaining null).
  let remaining: number | null = null;
  if (!isPremium(user)) {
    const quota = await consumeDiscoverSearch(user.userId);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: "You've used your 3 free searches this month. Upgrade to Based Reader for unlimited searches.",
          remaining: 0,
          freeLimit: FREE_DISCOVER_SEARCHES_PER_MONTH,
        },
        { status: 403 }
      );
    }
    remaining = quota.remaining;
  }
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
    // Accept single value (legacy) or array (multi-select, 2026-07-15).
    lengthPreference: ([] as string[]).concat(length ?? []).filter(Boolean) as DiscoverFilters["lengthPreference"],
    audience: ([] as string[]).concat(audience ?? []).filter((a) => a && a !== "any") as DiscoverFilters["audience"],
    libraryFilter,
    seriesStartersOnly,
    ignorePreferences,
  };

  const results = await getDiscoverRecommendations(
    user?.userId ?? null,
    filters,
    12
  );

  return NextResponse.json({ results, remaining });
}
