import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { resolveBook, getBookWithDetails } from "@/lib/queries/books";
import { getUserBookState } from "@/lib/queries/reading-state";
import { getBookAggregateRating } from "@/lib/queries/rating";
import { getBookSessionData } from "@/lib/queries/reading-session";
import { isBookInUpNext, getUpNextCount } from "@/lib/queries/up-next";
import { isBookFavorited } from "@/lib/queries/favorites";
import { getUserContentSensitivities, getBookContentWarningMatchesForUser } from "@/lib/queries/reading-preferences";
import { getWarningLabel } from "@/lib/content-warnings/vocabulary";
import { getUserShelves, getBookShelves } from "@/lib/queries/shelves";
import { getTbrNote } from "@/lib/queries/tbr-notes";
import { getUserReview } from "@/lib/queries/review";
import { getBookReadingNotes } from "@/lib/queries/reading-notes";
import { getFollowedUsersWhoRead } from "@/lib/queries/follows";
import { isBookHidden } from "@/lib/actions/hidden-books";
import { getUserOwnedEditions } from "@/lib/queries/editions";
import { getEffectiveCoverUrl } from "@/lib/covers";

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
    friendsWhoRead,
    hidden,
    ownedEditions,
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
    getFollowedUsersWhoRead(user.userId, bookId),
    isBookHidden(user.userId, bookId),
    getUserOwnedEditions(user.userId, bookId),
  ]);
  const warningMatches = await getBookContentWarningMatchesForUser(user.userId, bookId);

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

  // Square audiobook hero: ONLY when a real square audiobook image exists
  // AND the user's formats select it (mirrors getEffectiveCoverUrl branch 1).
  // A format choice without an uploaded image must NOT square the display.
  const activeFmts = userState?.activeFormats ?? [];
  const ownedFmts = userState?.ownedFormats ?? [];
  const isActivelyReading =
    userState?.state === "currently_reading" || userState?.state === "paused";
  const usesAudiobookCover =
    !!book.audiobookCoverUrl &&
    ((isActivelyReading && activeFmts.includes("audiobook")) ||
      (ownedFmts.length === 1 && ownedFmts[0] === "audiobook"));

  // Full display-cover cascade, same as the web book page: audiobook square →
  // the user's OWNED-EDITION cover → canonical book cover. Was missing here
  // (only the audiobook branch existed), so a user whose selected edition has
  // its own cover saw the canonical one in the app but their edition's on the
  // web (Between Two Fires, 2026-07-14).
  const effectiveCoverUrl = getEffectiveCoverUrl({
    baseCoverUrl: book.coverImageUrl,
    editionSelections: ownedEditions.map((e) => ({ format: e.format, coverId: e.coverId ?? null })),
    activeFormats: activeFmts,
    ownedFormats: ownedFmts,
    isActivelyReading,
    size: "L",
    audiobookCoverUrl: book.audiobookCoverUrl,
  });

  return jsonOk({
    book, // full getBookWithDetails payload (authors, series, genres, ratings, summary, description, …)
    slug: resolved.book.slug,
    usesAudiobookCover,
    effectiveCoverUrl,
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
    tbrNote: tbrNote ?? null, // getTbrNote returns string | null directly
    readingNotes: bookNotes,
    friendsWhoRead,
    isHidden: hidden,
    contentConflicts,
    // Reviewer-flagged + admin-note "topics to avoid" hits, labels resolved
    // and deduped server-side exactly like the web banner (2026-07-16):
    // a canonical covered by a reviewer flag doesn't repeat as a note hit,
    // and repeated note canonicals merge their category lists.
    reviewerWarnings: warningMatches.tagMatches.map((m) => ({
      label: getWarningLabel(m.canonicalId),
      count: m.count,
    })),
    noteWarnings: (() => {
      const reviewerIds = new Set(warningMatches.tagMatches.map((m) => m.canonicalId));
      const merged = new Map<string, { label: string; categories: string[] }>();
      for (const n of warningMatches.noteMatches) {
        if (reviewerIds.has(n.canonicalId)) continue;
        const entry = merged.get(n.canonicalId) ?? { label: getWarningLabel(n.canonicalId), categories: [] };
        if (!entry.categories.includes(n.categoryName)) entry.categories.push(n.categoryName);
        merged.set(n.canonicalId, entry);
      }
      return [...merged.values()];
    })(),
  });
}
