import { db } from "@/db";
import { authors, bookAuthors, books } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getAuthorWithBooks(authorId: string) {
  const author = await db.query.authors.findFirst({
    where: eq(authors.id, authorId),
  });
  if (!author) return null;

  const authorBooks = await db
    .select({
      id: books.id,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      publicationYear: books.publicationYear,
      isFiction: books.isFiction,
    })
    .from(bookAuthors)
    .innerJoin(books, eq(bookAuthors.bookId, books.id))
    .where(eq(bookAuthors.authorId, authorId));

  return {
    ...author,
    books: authorBooks,
  };
}
