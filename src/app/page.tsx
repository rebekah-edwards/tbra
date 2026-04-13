// Removed force-dynamic: cookies() in getCurrentUser() auto-triggers dynamic rendering
// for logged-in users. Logged-out users can benefit from edge caching.
import { unstable_cache } from "next/cache";

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "tbr*a — Know what's in a book before you read it",
  description: "Track your reading, discover books you ACTUALLY want to read, and DNF fewer books with comprehensive content details.",
  alternates: { canonical: "https://thebasedreader.app/" },
  openGraph: {
    title: "tbr*a — Know what's in a book before you read it",
    description: "Track your reading, discover books you ACTUALLY want to read, and DNF fewer books with comprehensive content details.",
    siteName: "tbr*a",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "tbr*a — Know what's in a book before you read it",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "tbr*a — Know what's in a book before you read it",
    description: "Track your reading, discover books you ACTUALLY want to read, and DNF fewer books with comprehensive content details.",
    images: ["/og-image.png"],
  },
};
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { books, bookCategoryRatings, taxonomyCategories, readingNotes } from "@/db/schema";
import { eq, isNotNull, and, sql, inArray, desc } from "drizzle-orm";
import { LandingPage } from "@/components/landing/landing-page";
import { landingPageBooks } from "@/db/schema";
import { getUserBooks } from "@/lib/queries/reading-state";
import { getUserUpNext } from "@/lib/queries/up-next";
import { getSmartDiscoveryBooks, getBecauseYouLikedSuggestions } from "@/lib/queries/recommendations";
import { getReadingGoal } from "@/lib/queries/reading-goals";
import { getReadingStreak } from "@/lib/queries/reading-streak";
import { getRandomOwnedTbrBook } from "@/lib/queries/tbr-suggestion";
import { BookCard } from "@/components/book-card";
import { ReadingGoalCard } from "@/components/home/reading-goal-card";
import { ReadingStreakCard } from "@/components/home/reading-streak-card";
import { TbrSuggestionCard } from "@/components/home/tbr-suggestion-card";
import { UpNextShelf } from "@/components/home/up-next-shelf";
import { CurrentlyReadingSection } from "@/components/home/currently-reading-section";
import { BecauseYouLiked } from "@/components/home/because-you-liked";
import { FriendsActivity } from "@/components/home/friends-activity";
import { InfoBubble } from "@/components/home/info-bubble";
import { getFollowedUsersActivity } from "@/lib/queries/activity-feed";
import { getFollowedUserIds } from "@/lib/queries/follows";
import { getBulkAggregateRatings } from "@/lib/queries/rating";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="section-heading text-xl lg:text-lg mb-4 lg:mb-3"
    >
      {children}
    </h2>
  );
}

function HorizontalScroll({
  books,
}: {
  books: { id: string; slug?: string | null; title: string; coverImageUrl: string | null; authors: string[]; isFiction?: boolean | null; userRating?: number | null; aggregateRating?: number | null; contentWarnings?: { categoryName: string; bookIntensity: number; userMax: number }[] }[];
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 pr-12 no-scrollbar mask-fade-right">
      {books.map((book) => (
        <div key={book.id} className="w-[130px] flex-shrink-0">
          <BookCard {...book} hasContentConflict={(book.contentWarnings?.length ?? 0) > 0} />
        </div>
      ))}
    </div>
  );
}


export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    // ── Landing Page (cached for 5 minutes to avoid re-querying on every request) ──
    const getLandingData = unstable_cache(
      async () => {
        const [paradeSlugRows, featuredSlugRow] = await Promise.all([
          db.select({ bookSlug: landingPageBooks.bookSlug })
            .from(landingPageBooks)
            .where(eq(landingPageBooks.type, "parade"))
            .orderBy(landingPageBooks.sortOrder),
          db.select({ bookSlug: landingPageBooks.bookSlug })
            .from(landingPageBooks)
            .where(eq(landingPageBooks.type, "featured"))
            .limit(1),
        ]);

        const paradeSlugs = paradeSlugRows.map((r) => r.bookSlug);
        const featuredSlug = featuredSlugRow[0]?.bookSlug ?? null;

        const [coverBooksRaw, featuredBookRow, totalCount] = await Promise.all([
          paradeSlugs.length > 0
            ? db
                .select({ id: books.id, title: books.title, coverImageUrl: books.coverImageUrl, slug: books.slug })
                .from(books)
                .where(and(inArray(books.slug, paradeSlugs), isNotNull(books.coverImageUrl)))
                .orderBy(sql`RANDOM()`)
            : Promise.resolve([]),
          featuredSlug
            ? db.query.books.findFirst({ where: eq(books.slug, featuredSlug) })
            : Promise.resolve(undefined),
          db.select({ count: sql<number>`COUNT(*)` }).from(books).where(eq(books.visibility, "public")),
        ]);

        return { coverBooksRaw, featuredBookRow, totalCount };
      },
      ["landing-page-data"],
      { revalidate: 300, tags: ["landing-page"] }
    );

    const { coverBooksRaw, featuredBookRow, totalCount } = await getLandingData();

    // Fetch content ratings for featured book
    let featuredBook = null;
    if (featuredBookRow?.id && featuredBookRow.coverImageUrl) {
      const ratings = await db
        .select({
          categoryKey: taxonomyCategories.key,
          categoryName: taxonomyCategories.name,
          intensity: bookCategoryRatings.intensity,
        })
        .from(bookCategoryRatings)
        .innerJoin(taxonomyCategories, eq(bookCategoryRatings.categoryId, taxonomyCategories.id))
        .where(eq(bookCategoryRatings.bookId, featuredBookRow.id))
        .all();

      featuredBook = {
        title: featuredBookRow.title,
        slug: featuredBookRow.slug || featuredBookRow.id,
        coverImageUrl: featuredBookRow.coverImageUrl,
        ratings,
      };
    }

    const coverBooks = coverBooksRaw
      .filter((b): b is typeof b & { coverImageUrl: string } => !!b.coverImageUrl)
      .map(b => ({ id: b.id, title: b.title, coverImageUrl: b.coverImageUrl, slug: b.slug }));

    const bookCount = Math.floor(((totalCount[0]?.count ?? 12000) as number) / 1000) * 1000;

    // Load editable copy from DB
    const { getLandingCopyMap } = await import("@/lib/actions/landing");
    const copy = await getLandingCopyMap();

    return <LandingPage featuredBook={featuredBook} coverBooks={coverBooks} bookCount={bookCount} copy={copy} />;
  }

  const currentYear = new Date().getFullYear();

  // ── Fast queries: load immediately ──
  const [allBooks, upNextItems, readingGoal, readingStreak, tbrSuggestion] = await Promise.all([
    getUserBooks(user.userId),
    getUserUpNext(user.userId),
    getReadingGoal(user.userId, currentYear),
    getReadingStreak(user.userId),
    getRandomOwnedTbrBook(user.userId),
  ]);

  const currentlyReading = allBooks.filter((b) => b.state === "currently_reading");

  // Query latest reading progress for currently-reading books
  const progressMap = new Map<string, number>();
  if (currentlyReading.length > 0) {
    const crBookIds = currentlyReading.map((b) => b.id);

    // Get reading notes + page counts in parallel
    const [latestNotes, bookPages] = await Promise.all([
      db
        .select({
          bookId: readingNotes.bookId,
          pageNumber: readingNotes.pageNumber,
          percentComplete: readingNotes.percentComplete,
        })
        .from(readingNotes)
        .where(
          and(
            eq(readingNotes.userId, user.userId),
            inArray(readingNotes.bookId, crBookIds),
            sql`(${readingNotes.pageNumber} IS NOT NULL OR ${readingNotes.percentComplete} IS NOT NULL)`
          )
        )
        .orderBy(desc(readingNotes.createdAt))
        .all(),
      db
        .select({ id: books.id, pages: books.pages })
        .from(books)
        .where(inArray(books.id, crBookIds))
        .all(),
    ]);
    const pagesMap = new Map(bookPages.map((b) => [b.id, b.pages]));

    // Take only the first (most recent) note per book
    const seen = new Set<string>();
    for (const note of latestNotes) {
      if (seen.has(note.bookId)) continue;
      seen.add(note.bookId);

      let pct: number | null = null;
      if (note.percentComplete != null && note.percentComplete > 0) {
        pct = note.percentComplete;
      } else if (note.pageNumber != null && note.pageNumber > 0) {
        const totalPages = pagesMap.get(note.bookId);
        if (totalPages && totalPages > 0) {
          pct = Math.round((note.pageNumber / totalPages) * 100);
        }
      }

      if (pct != null && pct > 0) {
        progressMap.set(note.bookId, Math.min(pct, 100));
      }
    }
  }

  // Look up active buddy reads for currently-reading books
  const buddyReadMap = new Map<string, string>();
  if (currentlyReading.length > 0) {
    const crBookIds = currentlyReading.map((b) => b.id);
    const buddyReadRows = await db.all(sql`
      SELECT br.id, br.book_id
      FROM buddy_reads br
      JOIN buddy_read_members brm ON brm.buddy_read_id = br.id
      WHERE br.status = 'active'
        AND brm.user_id = ${user.userId}
        AND brm.status = 'active'
        AND br.book_id IN (${sql.join(crBookIds.map((id) => sql`${id}`), sql`, `)})
    `) as { id: string; book_id: string }[];
    for (const row of buddyReadRows) {
      buddyReadMap.set(row.book_id, row.id);
    }
  }

  // Attach progress and buddy read to currently-reading books
  const currentlyReadingWithProgress = currentlyReading.map((b) => ({
    ...b,
    progress: progressMap.get(b.id) ?? null,
    buddyReadId: buddyReadMap.get(b.id) ?? null,
  }));

  return (
    <div className="space-y-8 lg:space-y-6 lg:max-w-[1194px] lg:mx-auto">
      {/* Goal + Streak: shown first on desktop via order, stays in DOM position on mobile */}
      <section className="hidden lg:flex gap-3 lg:justify-center">
        <ReadingGoalCard goal={readingGoal} year={currentYear} />
        <ReadingStreakCard streak={readingStreak} />
      </section>

      {/* Reading Now + Goal/Streak (mobile) + Up Next */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-8 space-y-8 lg:space-y-0">
      <section>
        <SectionHeading>Reading Now</SectionHeading>
        <CurrentlyReadingSection books={currentlyReadingWithProgress} />
      </section>

      {/* Mobile only: goal/streak between Reading Now and Up Next */}
      <section className="flex gap-3 lg:hidden">
        <ReadingGoalCard goal={readingGoal} year={currentYear} />
        <ReadingStreakCard streak={readingStreak} />
      </section>

      {(upNextItems.length > 0 || currentlyReading.length > 0) && (
        <section>
          <SectionHeading>Up Next</SectionHeading>
          <UpNextShelf items={upNextItems} />
        </section>
      )}
      </div>

      <section className="lg:max-w-lg lg:mx-auto">
        <SectionHeading>Pick From Your Shelf</SectionHeading>
        <TbrSuggestionCard initialBook={tbrSuggestion} />
      </section>

      {/* ── Heavy sections: stream in with Suspense ── */}
      <Suspense fallback={<HomeSkeleton />}>
        <DeferredHomeSections userId={user.userId} />
      </Suspense>
    </div>
  );
}

/** Skeleton placeholder while heavy sections stream in */
function HomeSkeleton() {
  return (
    <div className="space-y-8 lg:space-y-6 animate-pulse">
      {/* Because You Liked skeleton */}
      <div>
        <div className="h-5 w-48 bg-surface-alt rounded mb-4" />
        <div className="flex gap-4 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="w-[130px] flex-shrink-0">
              <div className="w-full aspect-[2/3] bg-surface-alt rounded-lg" />
              <div className="h-3 w-20 bg-surface-alt rounded mt-2" />
            </div>
          ))}
        </div>
      </div>
      {/* Discover skeleton */}
      <div>
        <div className="h-5 w-52 bg-surface-alt rounded mb-4" />
        <div className="flex gap-4 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="w-[130px] flex-shrink-0">
              <div className="w-full aspect-[2/3] bg-surface-alt rounded-lg" />
              <div className="h-3 w-20 bg-surface-alt rounded mt-2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Async component for heavy sections — streams in via Suspense */
async function DeferredHomeSections({ userId }: { userId: string }) {
  const [followedIds, discoveryBooks, becauseYouLiked] = await Promise.all([
    getFollowedUserIds(userId),
    getSmartDiscoveryBooks(userId),
    getBecauseYouLikedSuggestions(userId, 3, 8),
  ]);

  const friendsActivity = followedIds.size > 0
    ? await getFollowedUsersActivity(userId, 10)
    : [];

  // Hydrate recommendations with aggregate ratings
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

  return (
    <>
      {becauseYouLiked.length > 0 && (
        <BecauseYouLiked suggestions={becauseYouLiked} />
      )}

      {friendsActivity.length > 0 && (
        <section>
          <SectionHeading>Friends Activity</SectionHeading>
          <FriendsActivity activity={friendsActivity} />
        </section>
      )}

      {discoveryBooks.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4 lg:mb-3">
            <h2 className="section-heading text-xl lg:text-lg">Discover Something New</h2>
            <InfoBubble>
              Personalized picks based on your reading history &mdash; genres you love, fiction vs. nonfiction balance, and content comfort level. Only shows books not already on your shelves. Refreshes each visit.
            </InfoBubble>
          </div>
          <HorizontalScroll books={discoveryBooks} />
        </section>
      )}
    </>
  );
}
