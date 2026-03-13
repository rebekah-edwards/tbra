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
} from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function getBookWithDetails(bookId: string) {
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
    name: string;
    books: { id: string; title: string; coverImageUrl: string | null; position: number | null }[];
  } | null = null;

  if (seriesRow.length > 0) {
    const { seriesId, seriesName } = seriesRow[0];
    const seriesBooks = await db
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

    seriesInfo = {
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
