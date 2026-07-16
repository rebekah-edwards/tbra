import { getApiUser, hasPremiumAccess } from "@/lib/auth";
import { consumeDiscoverSearch } from "@/lib/discover-quota";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { getDiscoverRecommendations, type DiscoverFilters } from "@/lib/queries/recommendations";
import { getMoodFilters } from "@/lib/mood-genre-map";

/**
 * POST /api/v1/discover — mirrors /api/discover exactly (moods → genre
 * filters, fiction bias, length, audience, library filter, series
 * starters, preference override), bearer-authed for the native app.
 * Premium-only (Based Reader tier), matching the web route.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);
  // Free tier: 3 searches/month (2026-07-15); Based Reader unlimited.
  let remaining: number | null = null;
  if (!hasPremiumAccess(user)) {
    const quota = await consumeDiscoverSearch(user.userId);
    if (!quota.allowed) {
      return jsonError("You've used your 3 free searches this month. Upgrade to Based Reader for unlimited searches.", 403);
    }
    remaining = quota.remaining;
  }

  const body = (await parseJsonBody(req)) ?? {};

  const moods: string[] = Array.isArray(body.moods) ? body.moods.filter((m): m is string => typeof m === "string") : [];
  // length + audience accept a single value (legacy) or an array (multi-select).
  const length = ([] as string[]).concat(body.length ?? []).filter((v) => typeof v === "string");
  const fictionFilter = (body.fictionFilter ?? null) as "fiction" | "nonfiction" | "both" | null;
  const audience = ([] as string[]).concat(body.audience ?? []).filter((v) => typeof v === "string" && v !== "any");
  const libraryFilter = (body.libraryFilter ?? null) as "tbr" | "owned" | null;
  const seriesStartersOnly = body.seriesStartersOnly === true;
  const ignorePreferences = body.ignorePreferences === true;

  const moodFilters = getMoodFilters(moods);

  let fictionBias: "fiction" | "nonfiction" | null = moodFilters?.fictionBias ?? null;
  if (fictionFilter === "fiction") fictionBias = "fiction";
  else if (fictionFilter === "nonfiction") fictionBias = "nonfiction";
  else if (fictionFilter === "both") fictionBias = null;

  const filters: DiscoverFilters = {
    moodKeys: moods,
    boostKeywords: moodFilters?.boostKeywords ?? [],
    penaltyKeywords: moodFilters?.penaltyKeywords ?? [],
    contentMaxima: moodFilters?.contentMaxima ?? {},
    fictionBias,
    lengthPreference: length as DiscoverFilters["lengthPreference"],
    audience: audience as DiscoverFilters["audience"],
    libraryFilter,
    seriesStartersOnly,
    ignorePreferences,
  };

  const results = await getDiscoverRecommendations(user.userId, filters, 12);

  return jsonOk({
    results: results.map((b) => ({
      id: b.id,
      slug: b.slug,
      title: b.title,
      coverImageUrl: b.coverImageUrl,
      authors: b.authors,
      aggregateRating: b.aggregateRating ?? null,
      hasContentConflict: (b.contentWarnings?.length ?? 0) > 0,
      reason: b.reason ?? null,
    })),
    remaining,
  });
}
