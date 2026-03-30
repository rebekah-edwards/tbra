import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBrowseBooks, type BrowseFilters } from "@/lib/queries/browse";
import { getFollowedUserIds } from "@/lib/queries/follows";

export async function POST(request: Request) {
  const body = await request.json();
  const user = await getCurrentUser();

  const filters: BrowseFilters = {
    genre: body.genre || undefined,
    fiction: body.fiction || undefined,
    audience: body.audience || undefined,
    length: body.length || undefined,
    owned: body.owned || undefined,
    social: body.social || undefined,
    query: body.query || undefined,
    sort: body.sort || undefined,
  };

  const offset = Math.max(0, parseInt(body.offset, 10) || 0);
  const limit = Math.min(48, Math.max(1, parseInt(body.limit, 10) || 24));

  // Get followed user IDs for social filters
  let followedIds: string[] = [];
  if (user && (filters.social === "friends_read" || filters.social === "friends_tbr")) {
    const followedSet = await getFollowedUserIds(user.userId);
    followedIds = [...followedSet];
  }

  const result = await getBrowseBooks(filters, user?.userId ?? null, followedIds, offset, limit);

  return NextResponse.json(result);
}
