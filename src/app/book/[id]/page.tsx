import type { Metadata } from "next";
export const revalidate = 60;
import { notFound, redirect } from "next/navigation";
import { resolveBook, getBookWithDetails } from "@/lib/queries/books";
import { getUserBookState } from "@/lib/queries/reading-state";
import { getUserOwnedEditions } from "@/lib/queries/editions";
import { getBookAggregateRating } from "@/lib/queries/rating";
import { getUserReview } from "@/lib/queries/review";
import { getBookReviewSummaryData } from "@/lib/queries/review-summary";
import { hasCompletedSession, getLastCompletedSession } from "@/lib/queries/reading-session";
import { isBookInUpNext, getUpNextCount } from "@/lib/queries/up-next";
import { isBookFavorited } from "@/lib/queries/favorites";
import { getBookReadingNotes } from "@/lib/queries/reading-notes";
import { getUserContentSensitivities } from "@/lib/queries/reading-preferences";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { isBookHidden } from "@/lib/actions/hidden-books";
import { triggerEnrichment } from "@/lib/enrichment/trigger";
import { after } from "next/server";
import { BookAboutDetails } from "@/components/book/book-about-details";
import { BookSeries } from "@/components/book/book-series";
import { ContentProfile } from "@/components/book/content-profile";
import { ContentWarningBanner } from "@/components/book/content-warning-banner";
import { ReviewSummary } from "@/components/review/review-summary";
import { BookReadingNotes } from "@/components/book/book-reading-notes";
import { SimilarBooks } from "@/components/book/similar-books";
import { BookPageClient } from "./book-page-client";
import { AdminEditPanel } from "@/components/admin/admin-edit-panel";
import { FriendsWhoRead } from "@/components/book/friends-who-read";
import { BookSummary } from "@/components/book/book-summary";
import { HideBookButton } from "@/components/book/hide-book-button";
import { getFollowedUsersWhoRead } from "@/lib/queries/follows";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const resolved = await resolveBook(id);
  if (!resolved) return { title: "Book Not Found | tbr*a" };

  const book = await getBookWithDetails(resolved.book.id);
  if (!book) return { title: "Book Not Found | tbr*a" };

  const slug = resolved.book.slug;
  const canonicalUrl = slug
    ? `https://thebasedreader.app/book/${slug}`
    : `https://thebasedreader.app/book/${resolved.book.id}`;

  // Build author string for description
  const authorNames = book.authors.filter(a => a.role === "author").map(a => a.name);
  let authorStr = "";
  if (authorNames.length === 1) {
    authorStr = ` by ${authorNames[0]}`;
  } else if (authorNames.length === 2) {
    authorStr = ` by ${authorNames[0]} and ${authorNames[1]}`;
  } else if (authorNames.length >= 3) {
    authorStr = ` by ${authorNames[0]} et al.`;
  }

  const description = `Find comprehensive content breakdowns of what's in ${book.title}${authorStr}, add it to your shelf, and read based reviews.`;

  return {
    title: `What's Inside ${book.title} | tbr*a`,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `What's Inside ${book.title} | tbr*a`,
      description,
      type: "book",
      url: canonicalUrl,
      ...(book.coverImageUrl ? { images: [{ url: book.coverImageUrl }] } : {}),
    },
  };
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Resolve by UUID or slug
  const resolved = await resolveBook(id);
  if (!resolved) {
    notFound();
  }

  // If accessed by UUID and book has a slug, 301 redirect to canonical slug URL
  if (resolved.isIdLookup && resolved.book.slug) {
    redirect(`/book/${resolved.book.slug}`);
  }

  const bookId = resolved.book.id;
  const user = await getCurrentUser();
  const book = await getBookWithDetails(bookId, user?.userId);

  if (!book) {
    notFound();
  }
  // Run all independent queries in parallel for better performance
  const [
    userState,
    rawEditions,
    userReview,
    hasCompleted,
    lastSession,
    upNextPosition,
    upNextCount,
    isFavoritedResult,
    readingNotes,
    isHidden,
    friendsWhoRead,
    aggregate,
    reviewSummary,
    userSensitivities,
  ] = await Promise.all([
    user ? getUserBookState(user.userId, bookId) : null,
    user ? getUserOwnedEditions(user.userId, bookId) : Promise.resolve([]),
    user ? getUserReview(user.userId, bookId) : null,
    user ? hasCompletedSession(user.userId, bookId) : false,
    user ? getLastCompletedSession(user.userId, bookId) : null,
    user ? isBookInUpNext(user.userId, bookId) : null,
    user ? getUpNextCount(user.userId) : 0,
    user ? isBookFavorited(user.userId, bookId) : null,
    user ? getBookReadingNotes(user.userId, bookId) : Promise.resolve([]),
    user ? isBookHidden(user.userId, bookId) : false,
    user ? getFollowedUsersWhoRead(user.userId, bookId) : Promise.resolve([]),
    getBookAggregateRating(bookId),
    getBookReviewSummaryData(bookId),
    user ? getUserContentSensitivities(user.userId) : null,
  ]);

  const editionSelections = rawEditions.map((e) => ({
    editionId: e.editionId,
    format: e.format,
    openLibraryKey: e.openLibraryKey,
    coverId: e.coverId ?? null,
  }));
  const isFavorited = isFavoritedResult !== null;

  // Compute content conflicts between book ratings and user preferences
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

  // Detect unenriched books and trigger enrichment on visit
  const needsEnrichment = book.ratings.length === 0 && !book.summary;

  if (needsEnrichment && process.env.ENRICHMENT_PAUSED !== "true") {
    after(() => triggerEnrichment(book.id));
  }

  return (
    <div>

      <BookPageClient
        book={{
          id: book.id,
          title: book.title,
          coverImageUrl: book.coverImageUrl,
          authors: book.authors,
          genres: book.genres,
          publicationYear: book.publicationYear,
          pages: book.pages,
          audioLengthMinutes: book.audioLengthMinutes,
          openLibraryKey: book.openLibraryKey,
          isFiction: book.isFiction ?? null,
          topLevelGenre: book.topLevelGenre ?? null,
          ageCategory: book.ageCategory ?? null,
          description: book.description ?? null,
          summary: book.summary ?? null,
          isbn13: book.isbn13 ?? null,
          asin: book.asin ?? null,
        }}
        userState={{
          state: userState?.state ?? null,
          ownedFormats: userState?.ownedFormats ?? [],
          activeFormats: userState?.activeFormats ?? [],
        }}
        isLoggedIn={!!user}
        isAdmin={isAdmin(user)}
        canReport={!!user && ["beta_tester", "admin", "super_admin"].includes(user.accountType)}
        editionSelections={editionSelections}
        userReview={userReview}
        aggregate={aggregate}
        hasCompletedSession={hasCompleted}
        lastReadFormat={lastSession?.activeFormats?.[0] ?? null}
        lastReadDate={lastSession?.completionDate ?? null}
        lastReadPrecision={lastSession?.completionPrecision ?? null}
        upNextPosition={upNextPosition}
        upNextCount={upNextCount}
        isFavorited={isFavorited}
        isRecentlyImported={needsEnrichment}
        isHidden={isHidden}
        contentConflicts={contentConflicts}
      />

      {/* Content warning — mobile only here, desktop version goes under reviews */}
      {contentConflicts.length > 0 && (
        <div className="px-4 lg:hidden">
          <ContentWarningBanner conflicts={contentConflicts} />
        </div>
      )}

      {/* Book summary — mobile: full-bleed styled block; desktop: inline in right card */}
      {book.summary && (
        <div className="lg:hidden">
          <BookSummary summary={book.summary} variant="frosted" layout="mobile" />
        </div>
      )}

      {/* Pre-release banner */}
      {(() => {
        const now = new Date();
        const pubDate = book.publicationDate;
        const pubYear = book.publicationYear;
        let isPreRelease = false;
        let releaseLabel = "";

        if (pubDate) {
          const parts = pubDate.split("-");
          if (parts.length === 3) {
            const d = new Date(pubDate + "T00:00:00");
            if (d > now) {
              isPreRelease = true;
              releaseLabel = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
            }
          } else if (parts.length === 2) {
            const d = new Date(Number(parts[0]), Number(parts[1]), 0);
            if (d > now) {
              isPreRelease = true;
              const label = new Date(pubDate + "-01T00:00:00");
              releaseLabel = label.toLocaleDateString("en-US", { year: "numeric", month: "long" });
            }
          }
        } else if (pubYear && pubYear > now.getFullYear()) {
          isPreRelease = true;
          releaseLabel = String(pubYear);
        }

        if (!isPreRelease) return null;
        return (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-foreground">
            <span>📅</span>
            <span>
              Releases <strong>{releaseLabel}</strong>
            </span>
          </div>
        );
      })()}

      {/* Section 2: Content area — always has About + What Readers Think; optionally Series as 3rd col */}
      {(() => {
        const hasSeries = book.seriesInfo && book.seriesInfo.books.length > 1;
        const hasReviews = reviewSummary && reviewSummary.totalReviewCount > 0;
        return (
      <div className={hasSeries ? "lg:grid lg:grid-cols-[1.2fr_1fr_1fr] lg:gap-6 lg:mt-4" : "lg:grid lg:grid-cols-[3fr_2fr] lg:gap-8 lg:max-w-4xl lg:mx-auto lg:mt-4"}>
        {/* Left column: About + Details */}
        <div className="lg:min-h-0">
          <BookAboutDetails
            description={book.description}
            publicationDate={book.publicationDate ?? null}
            publicationYear={book.publicationYear ?? null}
            pages={book.pages ?? null}
            language={book.language ?? null}
            publisher={book.publisher ?? null}
            isbn13={book.isbn13 ?? null}
            isbn10={book.isbn10 ?? null}
            asin={book.asin ?? null}
            isFiction={book.isFiction ?? null}
            audioLengthMinutes={book.audioLengthMinutes ?? null}
            seriesName={book.seriesInfo?.name ?? null}
            seriesPosition={book.seriesPosition ?? null}
          />

          {user?.role === "admin" && (
            <AdminEditPanel
              bookId={book.id}
              bookTitle={book.title}
              openLibraryKey={book.openLibraryKey}
              currentValues={{
                coverImageUrl: book.coverImageUrl,
                title: book.title,
                publicationYear: book.publicationYear ?? null,
                publicationDate: book.publicationDate ?? null,
                pages: book.pages ?? null,
                audioLengthMinutes: book.audioLengthMinutes ?? null,
                publisher: book.publisher ?? null,
                language: book.language ?? null,
                isbn13: book.isbn13 ?? null,
                isbn10: book.isbn10 ?? null,
                asin: book.asin ?? null,
                isFiction: book.isFiction ?? null,
                description: book.description ?? null,
                summary: book.summary ?? null,
                genres: book.genres,
              }}
            />
          )}
        </div>

        {/* Middle column: What Readers Think (always shown on desktop) + content warning */}
        <div className="lg:min-h-0">
          {hasReviews ? (
            <ReviewSummary data={reviewSummary} bookId={bookId} bookSlug={resolved.book.slug} />
          ) : (
            <section className="mt-8 space-y-4 hidden lg:block">
              <h2 className="section-heading text-xl">What Readers Think</h2>
              <p className="text-sm text-muted/60">Finish reading to leave a review</p>
            </section>
          )}

          {readingNotes.length > 0 && (
            <BookReadingNotes notes={readingNotes} bookSlug={resolved.book.slug} bookId={bookId} />
          )}

          {friendsWhoRead.length > 0 && (
            <div className="px-4 lg:px-0">
              <FriendsWhoRead friends={friendsWhoRead} bookId={bookId} bookSlug={resolved.book.slug} />
            </div>
          )}

          {/* Content warning removed from here — shown in top-right card instead */}
        </div>

        {/* Right column: Series (only if series exists) */}
        {hasSeries && (
          <div className="lg:min-h-0">
            <BookSeries
              seriesId={book.seriesInfo!.id}
              seriesSlug={book.seriesInfo!.slug}
              name={book.seriesInfo!.name}
              books={book.seriesInfo!.books}
              currentBookId={book.id}
            />
          </div>
        )}
      </div>
        );
      })()}

      {/* Section 3: What's Inside — full width */}
      <ContentProfile ratings={book.ratings} bookId={bookId} isLoggedIn={!!user} isAdmin={isAdmin(user)} />

      {user && (
        <div className="mt-10 flex justify-center">
          <HideBookButton bookId={bookId} bookTitle={book.title} initialIsHidden={isHidden} />
        </div>
      )}
      <div className="book-page-divider">{""}</div>

      {/* Section 4: Similar Books — full width */}
      <SimilarBooks bookId={bookId} />
    </div>
  );
}
