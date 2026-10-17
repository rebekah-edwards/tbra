import { cache } from "react";
import { db } from "@/db";
import { authors, bookAuthors, books, bookSeries, series } from "@/db/schema";
import { eq, asc, and, ne } from "drizzle-orm";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Resolve an author by UUID or slug.
 * Wrapped in React cache() so generateMetadata + page component share the result.
 */
export const resolveAuthor = cache(async function resolveAuthor(idOrSlug: string) {
  if (UUID_PATTERN.test(idOrSlug)) {
    const author = await db.query.authors.findFirst({ where: eq(authors.id, idOrSlug) });
    return author ? { author, isIdLookup: true } : null;
  }
  const author = await db.query.authors.findFirst({ where: eq(authors.slug, idOrSlug) });
  return author ? { author, isIdLookup: false } : null;
});

/**
 * Get an author by slug with all their books (excluding box sets),
 * grouped by series and sorted by publication year.
 */
export async function getAuthorBySlug(slug: string) {
  const author = await db.query.authors.findFirst({
    where: eq(authors.slug, slug),
  });
  if (!author) return null;

  return { ...author, books: await getAuthorBooks(author.id) };
}

/**
 * Get all books by an author, excluding box sets, sorted by publication year.
 * Includes series info for grouping.
 *
 * Filters to visibility='public' like every other browse surface (browse.ts).
 * Without it the page listed `import_only` rows too — on /author/lisa-jewell that
 * was 12 foreign-language translations of books already listed in English
 * (Dentro de casa, Dins de casa, On se reverra ×2, Gwiazda jednego przeboju,
 * Ruya Sokagi 31, Wo deine Träume wohnen …), which read as duplicates to users
 * and were reported as such on 2026-10-16.
 */
export async function getAuthorBooks(authorId: string) {
  const authorBookRows = await db
    .select({
      id: books.id,
      title: books.title,
      slug: books.slug,
      coverImageUrl: books.coverImageUrl,
      publicationYear: books.publicationYear,
      isFiction: books.isFiction,
      isBoxSet: books.isBoxSet,
    })
    .from(bookAuthors)
    .innerJoin(books, eq(bookAuthors.bookId, books.id))
    .where(
      and(
        eq(bookAuthors.authorId, authorId),
        ne(books.isBoxSet, true),
        eq(books.visibility, "public"),
      ),
    )
    .orderBy(asc(books.publicationYear));

  // Enrich with series info
  const enriched = [];
  for (const book of authorBookRows) {
    const seriesRow = await db
      .select({
        seriesId: series.id,
        seriesName: series.name,
        seriesSlug: series.slug,
        position: bookSeries.positionInSeries,
      })
      .from(bookSeries)
      .innerJoin(series, eq(bookSeries.seriesId, series.id))
      .where(eq(bookSeries.bookId, book.id))
      .limit(1);

    enriched.push({
      ...book,
      seriesInfo: seriesRow.length > 0
        ? { id: seriesRow[0].seriesId, name: seriesRow[0].seriesName, slug: seriesRow[0].seriesSlug, position: seriesRow[0].position }
        : null,
    });
  }

  return enriched;
}
