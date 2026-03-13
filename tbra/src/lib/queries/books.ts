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
} from "@/db/schema";
import { eq } from "drizzle-orm";

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

  return {
    ...book,
    authors: bookAuthorRows,
    genres: bookGenreRows.map((g) => g.name),
    ratings,
    links: bookLinks,
  };
}
