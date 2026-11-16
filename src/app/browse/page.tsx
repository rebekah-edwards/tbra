import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getFollowedUserIds } from "@/lib/queries/follows";
import { getBrowseBooks, type BrowseFilters, type BrowseResult } from "@/lib/queries/browse";
import { BrowseClient } from "./browse-client";

export const metadata: Metadata = {
  title: "Browse All Books on tbr*a",
  description: "Browse the full tbr*a book catalog. Filter by genre, rating, and more.",
  // Filter/sort URLs (?genre=…) are views of this page, not pages of their own.
  alternates: { canonical: "https://thebasedreader.app/browse" },
};

const PAGE_SIZE = 24;

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [user, sp] = await Promise.all([getCurrentUser(), searchParams]);

  let followedIds: string[] = [];
  if (user) followedIds = [...(await getFollowedUserIds(user.userId))];

  // Render the first page of results on the server (2026-11-16). The list used
  // to arrive only via a client POST to /api/browse — robots.txt blocks /api/,
  // so Google saw "0 books / Loading books..." and filed /browse as a soft 404.
  // Same filter mapping as src/app/api/browse/route.ts.
  const filters: BrowseFilters = {
    genre: first(sp.genre) || undefined,
    fiction: (first(sp.fiction) || undefined) as BrowseFilters["fiction"],
    audience: (first(sp.audience) || undefined) as BrowseFilters["audience"],
    length: (first(sp.length) || undefined) as BrowseFilters["length"],
    owned: (first(sp.owned) || undefined) as BrowseFilters["owned"],
    social: (first(sp.social) || undefined) as BrowseFilters["social"],
    query: first(sp.q) || undefined,
    sort: first(sp.sort) || "popular",
  };
  const needsFollows = filters.social === "friends_read" || filters.social === "friends_tbr";

  let initial: BrowseResult | null = null;
  try {
    initial = await getBrowseBooks(
      filters,
      user?.userId ?? null,
      needsFollows ? followedIds : [],
      0,
      PAGE_SIZE,
    );
  } catch {
    // Fall back to the client fetch, which has its own error + retry UI.
    initial = null;
  }

  return (
    <Suspense>
      <BrowseClient isLoggedIn={!!user} hasFollows={followedIds.length > 0} initial={initial} />
    </Suspense>
  );
}
