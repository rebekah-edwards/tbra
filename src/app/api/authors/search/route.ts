import { NextResponse } from "next/server";
import { db } from "@/db";
import { authors, bookAuthors, books } from "@/db/schema";
import { like, eq, sql } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  // Find matching authors who have at least one book
  const results = await db
    .select({
      id: authors.id,
      name: authors.name,
      bookCount: sql<number>`count(${bookAuthors.bookId})`,
    })
    .from(authors)
    .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
    .where(like(authors.name, `%${q}%`))
    .groupBy(authors.id)
    .orderBy(sql`count(${bookAuthors.bookId}) desc`)
    .limit(3);

  if (results.length === 0) {
    return NextResponse.json([]);
  }

  // For each author, fetch a few sample book covers
  const enriched = await Promise.all(
    results.map(async (author) => {
      const sampleBooks = await db
        .select({
          id: books.id,
          title: books.title,
          coverImageUrl: books.coverImageUrl,
        })
        .from(bookAuthors)
        .innerJoin(books, eq(books.id, bookAuthors.bookId))
        .where(eq(bookAuthors.authorId, author.id))
        .limit(5);

      return {
        id: author.id,
        name: author.name,
        bookCount: author.bookCount,
        sampleBooks,
      };
    })
  );

  return NextResponse.json(enriched);
}
