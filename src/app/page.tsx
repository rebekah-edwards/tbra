export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "tbr*a — Know what's in a book before you read it",
  description: "Detailed content ratings, smart recommendations, and reading tools for readers who care about what they read.",
};
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { books, bookCategoryRatings, taxonomyCategories } from "@/db/schema";
import { eq, isNotNull, and, sql, inArray } from "drizzle-orm";
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
  books: { id: string; slug?: string | null; title: string; coverImageUrl: string | null; authors: string[]; isFiction?: boolean | null; userRating?: number | null; aggregateRating?: number | null }[];
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 pr-12 no-scrollbar mask-fade-right">
      {books.map((book) => (
        <div key={book.id} className="w-[130px] flex-shrink-0">
          <BookCard {...book} />
        </div>
      ))}
    </div>
  );
}


export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    // ── Landing Page Configuration ──
    // Slugs are managed via /admin/landing
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

    return <LandingPage featuredBook={featuredBook} coverBooks={coverBooks} bookCount={bookCount} />;
  }

  const currentYear = new Date().getFullYear();

  // Fetch all data in parallel — maximizes concurrency
  const [allBooks, upNextItems, readingGoal, readingStreak, tbrSuggestion, followedIds, discoveryBooks, becauseYouLiked] = await Promise.all([
    getUserBooks(user.userId),
    getUserUpNext(user.userId),
    getReadingGoal(user.userId, currentYear),
    getReadingStreak(user.userId),
    getRandomOwnedTbrBook(user.userId),
    getFollowedUserIds(user.userId),
    getSmartDiscoveryBooks(user.userId),
    getBecauseYouLikedSuggestions(user.userId, 3, 8),
  ]);

  // Friends activity depends on followedIds
  const friendsActivity = followedIds.size > 0
    ? await getFollowedUsersActivity(user.userId, 10)
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

  const currentlyReading = allBooks.filter((b) => b.state === "currently_reading");

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
        <CurrentlyReadingSection books={currentlyReading} />
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
    </div>
  );
}
