import { db } from "@/db";
import {
  books,
  authors,
  bookAuthors,
  genres,
  bookGenres,
  bookCategoryRatings,
  taxonomyCategories,
  links,
  series,
  bookSeries,
  userBookRatings,
  userOwnedEditions,
  editions,
  userBookState,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { buildCoverUrl } from "@/lib/openlibrary";

export async function getBookWithDetails(bookId: string, userId?: string | null) {
  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });
  if (!book) return null;

  // Get authors
  const bookAuthorRows = await db
    .select({ id: authors.id, name: authors.name, role: bookAuthors.role })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(eq(bookAuthors.bookId, bookId));

  // Get genres
  const bookGenreRows = await db
    .select({ name: genres.name })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(eq(bookGenres.bookId, bookId));

  // Get category ratings with category info
  const ratings = await db
    .select({
      categoryKey: taxonomyCategories.key,
      categoryName: taxonomyCategories.name,
      intensity: bookCategoryRatings.intensity,
      notes: bookCategoryRatings.notes,
      evidenceLevel: bookCategoryRatings.evidenceLevel,
    })
    .from(bookCategoryRatings)
    .innerJoin(
      taxonomyCategories,
      eq(bookCategoryRatings.categoryId, taxonomyCategories.id)
    )
    .where(eq(bookCategoryRatings.bookId, bookId));

  // Get links
  const bookLinks = await db
    .select()
    .from(links)
    .where(eq(links.bookId, bookId));

  // Get series info
  const seriesRow = await db
    .select({
      seriesId: series.id,
      seriesName: series.name,
      position: bookSeries.positionInSeries,
    })
    .from(bookSeries)
    .innerJoin(series, eq(bookSeries.seriesId, series.id))
    .where(eq(bookSeries.bookId, bookId))
    .limit(1);

  let seriesInfo: {
    id: string;
    name: string;
    books: { id: string; title: string; coverImageUrl: string | null; position: number | null; userRating: number | null }[];
  } | null = null;

  if (seriesRow.length > 0) {
    const { seriesId, seriesName } = seriesRow[0];
    const seriesBooksRaw = await db
      .select({
        id: books.id,
        title: books.title,
        coverImageUrl: books.coverImageUrl,
        position: bookSeries.positionInSeries,
      })
      .from(bookSeries)
      .innerJoin(books, eq(bookSeries.bookId, books.id))
      .where(eq(bookSeries.seriesId, seriesId))
      .orderBy(asc(bookSeries.positionInSeries));

    // Enrich with user ratings and effective covers
    const seriesBooks = [];
    for (const sb of seriesBooksRaw) {
      let userRating: number | null = null;
      let effectiveCover = sb.coverImageUrl;

      if (userId) {
        // Get user rating
        const rating = await db
          .select({ rating: userBookRatings.rating })
          .from(userBookRatings)
          .where(and(eq(userBookRatings.userId, userId), eq(userBookRatings.bookId, sb.id)))
          .get();
        userRating = rating?.rating ?? null;

        // Check if user has an owned/reading edition with a cover for this book
        const editionRows = await db
          .select({ coverId: editions.coverId, format: userOwnedEditions.format })
          .from(userOwnedEditions)
          .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
          .where(and(eq(userOwnedEditions.userId, userId), eq(userOwnedEditions.bookId, sb.id)))
          .all();

        for (const ed of editionRows) {
          if (ed.coverId) {
            const edCover = buildCoverUrl(ed.coverId, "M");
            if (edCover) {
              effectiveCover = edCover;
              break;
            }
          }
        }
      }

      // For the current book, use the current book's cover (which already has edition cascade)
      // For other books, use their effective cover
      seriesBooks.push({
        id: sb.id,
        title: sb.title,
        coverImageUrl: effectiveCover,
        position: sb.position,
        userRating,
      });
    }

    seriesInfo = {
      id: seriesId,
      name: seriesName,
      books: seriesBooks,
    };
  }

  return {
    ...book,
    authors: bookAuthorRows,
    genres: bookGenreRows.map((g) => g.name),
    ratings,
    links: bookLinks,
    seriesInfo,
  };
}

export async function getSeriesBooks(seriesId: string, userId: string | null) {
  const seriesRow = await db
    .select({ name: series.name })
    .from(series)
    .where(eq(series.id, seriesId))
    .get();

  if (!seriesRow) return null;

  const seriesBooksRaw = await db
    .select({
      id: books.id,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      position: bookSeries.positionInSeries,
    })
    .from(bookSeries)
    .innerJoin(books, eq(bookSeries.bookId, books.id))
    .where(eq(bookSeries.seriesId, seriesId))
    .orderBy(asc(bookSeries.positionInSeries));

  const enrichedBooks = [];
  for (const sb of seriesBooksRaw) {
    // Get authors
    const bookAuthorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, sb.id))
      .all();

    let userRating: number | null = null;
    let currentState: string | null = null;
    let effectiveCover = sb.coverImageUrl;

    if (userId) {
      const rating = await db
        .select({ rating: userBookRatings.rating })
        .from(userBookRatings)
        .where(and(eq(userBookRatings.userId, userId), eq(userBookRatings.bookId, sb.id)))
        .get();
      userRating = rating?.rating ?? null;

      const state = await db
        .select({ state: userBookState.state })
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, sb.id)))
        .get();
      currentState = state?.state ?? null;

      const editionRows = await db
        .select({ coverId: editions.coverId })
        .from(userOwnedEditions)
        .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
        .where(and(eq(userOwnedEditions.userId, userId), eq(userOwnedEditions.bookId, sb.id)))
        .all();

      for (const ed of editionRows) {
        if (ed.coverId) {
          const edCover = buildCoverUrl(ed.coverId, "M");
          if (edCover) {
            effectiveCover = edCover;
            break;
          }
        }
      }
    }

    enrichedBooks.push({
      id: sb.id,
      title: sb.title,
      coverImageUrl: effectiveCover,
      position: sb.position,
      authors: bookAuthorRows.map((a) => a.name),
      userRating,
      currentState,
    });
  }

  return {
    name: seriesRow.name,
    books: enrichedBooks,
  };
}
