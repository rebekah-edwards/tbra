import { notFound } from "next/navigation";
import { getBookWithDetails } from "@/lib/queries/books";
import { getUserBookState } from "@/lib/queries/reading-state";
import { getUserOwnedEditions } from "@/lib/queries/editions";
import { getBookAggregateRating } from "@/lib/queries/rating";
import { getUserReview } from "@/lib/queries/review";
import { getCurrentUser } from "@/lib/auth";
import { BookDescription } from "@/components/book/book-description";
import { BookSeries } from "@/components/book/book-series";
import { ContentProfile } from "@/components/book/content-profile";
import { BookPageClient } from "./book-page-client";

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const book = await getBookWithDetails(id, user?.userId);

  if (!book) {
    notFound();
  }
  const userState = user ? await getUserBookState(user.userId, id) : null;
  const editionSelections = user
    ? (await getUserOwnedEditions(user.userId, id)).map((e) => ({
        editionId: e.editionId,
        format: e.format,
        openLibraryKey: e.openLibraryKey,
        coverId: e.coverId ?? null,
      }))
    : [];
  const userReview = user ? await getUserReview(user.userId, id) : null;
  const aggregate = await getBookAggregateRating(id);

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
        }}
        userState={{
          state: userState?.state ?? null,
          ownedFormats: userState?.ownedFormats ?? [],
          activeFormats: userState?.activeFormats ?? [],
        }}
        isLoggedIn={!!user}
        editionSelections={editionSelections}
        userReview={userReview}
        aggregate={aggregate}
      />

      {book.summary && (
        <p className="mt-8 text-center text-lg italic leading-relaxed text-foreground/80">
          {book.summary}
        </p>
      )}

      <BookDescription description={book.description} />

      {book.seriesInfo && (
        <BookSeries
          seriesId={book.seriesInfo.id}
          name={book.seriesInfo.name}
          books={book.seriesInfo.books}
          currentBookId={book.id}
        />
      )}

      <ContentProfile ratings={book.ratings} />
    </div>
  );
}
