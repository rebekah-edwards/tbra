import { db } from "@/db";
import { books, bookAuthors, authors } from "@/db/schema";
import { sql, isNotNull } from "drizzle-orm";
import { eq } from "drizzle-orm";

export interface DiscoveryBook {
  id: string;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
}

/**
 * Get a selection of books for the discovery section.
 * Returns random books that have covers and descriptions (well-imported books).
 */
export async function getDiscoveryBooks(limit = 10): Promise<DiscoveryBook[]> {
  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
    })
    .from(books)
    .where(isNotNull(books.coverImageUrl))
    .orderBy(sql`RANDOM()`)
    .limit(limit);

  const result: DiscoveryBook[] = [];
  for (const row of rows) {
    const authorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, row.id));

    result.push({
      ...row,
      authors: authorRows.map((a) => a.name),
    });
  }

  return result;
}
