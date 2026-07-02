import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getFollowedUserIds } from "@/lib/queries/follows";
import { getFollowedUsersActivity } from "@/lib/queries/activity-feed";
import { getSmartDiscoveryBooks, getBecauseYouLikedSuggestions } from "@/lib/queries/recommendations";
import { getBulkAggregateRatings } from "@/lib/queries/rating";

/**
 * GET /api/v1/home/discover
 * The home page's deferred sections — mirrors DeferredHomeSections in
 * src/app/page.tsx exactly: Because You Liked, Friends Activity, and
 * Discover Something New, with aggregate-rating hydration.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const [followedIds, discoveryBooks, becauseYouLiked] = await Promise.all([
    getFollowedUserIds(user.userId),
    getSmartDiscoveryBooks(user.userId),
    getBecauseYouLikedSuggestions(user.userId, 3, 8),
  ]);

  const friendsActivity = followedIds.size > 0
    ? await getFollowedUsersActivity(user.userId, 10)
    : [];

  // Hydrate recommendations with aggregate ratings (same as the web)
  const allRecBookIds = [
    ...discoveryBooks.map((b) => b.id),
    ...becauseYouLiked.flatMap(({ books }) => books.map((b) => b.id)),
  ];
  const ratingsMap = await getBulkAggregateRatings(allRecBookIds);
  for (const book of discoveryBooks) {
    book.aggregateRating = ratingsMap.get(book.id) ?? null;
  }
  for (const { books } of becauseYouLiked) {
    for (const book of books) {
      book.aggregateRating = ratingsMap.get(book.id) ?? null;
    }
  }

  const liteBook = (b: {
    id: string; slug: string | null; title: string; coverImageUrl: string | null;
    authors: string[]; aggregateRating?: number | null;
    contentWarnings?: unknown[];
  }) => ({
    id: b.id,
    slug: b.slug,
    title: b.title,
    coverImageUrl: b.coverImageUrl,
    authors: b.authors,
    aggregateRating: b.aggregateRating ?? null,
    hasContentConflict: (b.contentWarnings?.length ?? 0) > 0,
  });

  return jsonOk({
    becauseYouLiked: becauseYouLiked.map(({ seed, books }) => ({
      seed: { id: seed.id, title: seed.title },
      books: books.map(liteBook),
    })),
    friendsActivity,
    discover: discoveryBooks.map(liteBook),
  });
}
