import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { resolveBook, getBookWithDetails } from "@/lib/queries/books";
import { getUserBookState } from "@/lib/queries/reading-state";
import { getBookAggregateRating } from "@/lib/queries/rating";
import { getBookSessionData } from "@/lib/queries/reading-session";
import { isBookInUpNext, getUpNextCount } from "@/lib/queries/up-next";
import { isBookFavorited } from "@/lib/queries/favorites";
import { getUserContentSensitivities } from "@/lib/queries/reading-preferences";
import { getUserShelves, getBookShelves } from "@/lib/queries/shelves";
import { getTbrNote } from "@/lib/queries/tbr-notes";
import { getUserReview } from "@/lib/queries/review";
import { getBookReadingNotes } from "@/lib/queries/reading-notes";

/**
 * GET /api/v1/books/[id]  (id = uuid or slug)
 * The book page payload: hero, action-cluster state, summary, and the
 * What's Inside content profile — assembled from the exact queries the
 * web page uses (src/app/book/[id]/page.tsx).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const bookId = resolved.book.id;

  const book = await getBookWithDetails(bookId, user.userId);
  if (!book) return jsonError("Book not found.", 404);

  const [
    userState,
    sessionData,
    upNextPosition,
    upNextCount,
    isFavoritedResult,
    aggregate,
    userSensitivities,
    userShelves,
    bookShelfMemberships,
    tbrNote,
    userReview,
    bookNotes,
  ] = await Promise.all([
    getUserBookState(user.userId, bookId),
    getBookSessionData(user.userId, bookId),
    isBookInUpNext(user.userId, bookId),
    getUpNextCount(user.userId),
    isBookFavorited(user.userId, bookId),
    getBookAggregateRating(bookId),
    getUserContentSensitivities(user.userId),
    getUserShelves(user.userId),
    getBookShelves(user.userId, bookId),
    getTbrNote(user.userId, bookId),
    getUserReview(user.userId, bookId),
    getBookReadingNotes(user.userId, bookId),
  ]);

  // Content conflicts vs the user's tolerances (same logic as the web page)
  const contentConflicts: { categoryName: string; bookIntensity: number; userMax: number }[] = [];
  if (userSensitivities && book.ratings.length > 0) {
    const userPrefsMap = new Map(
      userSensitivities.contentPreferences.map((cp) => [cp.categoryId, cp.maxTolerance])
    );
    for (const rating of book.ratings) {
      const userMax = userPrefsMap.get(rating.categoryId);
      if (userMax !== undefined && userMax < 4 && rating.intensity > userMax) {
        contentConflicts.push({
          categoryName: rating.categoryName,
          bookIntensity: rating.intensity,
          userMax,
        });
      }
    }
  }

  return jsonOk({
    book, // full getBookWithDetails payload (authors, series, genres, ratings, summary, description, …)
    slug: resolved.book.slug,
    userState, // { state, ownedFormats, activeFormats } | null
    hasCompleted: sessionData.hasCompleted,
    sessions: sessionData.sessions,
    upNextPosition,
    upNextCount,
    isFavorited: isFavoritedResult !== null,
    aggregate, // { average, count } | null
    userRating: userReview?.rating ?? null,
    userShelves,
    bookShelfIds: bookShelfMemberships.map((s) => s.shelfId),
    tbrNote: tbrNote?.note ?? null,
    readingNotes: bookNotes,
    contentConflicts,
  });
}
