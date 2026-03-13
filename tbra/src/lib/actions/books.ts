"use server";

import { db } from "@/db";
import { books, authors, bookAuthors } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  fetchOpenLibraryWork,
  buildCoverUrl,
  type OLSearchResult,
} from "@/lib/openlibrary";

export async function importFromOpenLibrary(result: OLSearchResult) {
  // Check if already imported
  const existing = await db.query.books.findFirst({
    where: eq(books.openLibraryKey, result.key),
  });
  if (existing) {
    redirect(`/book/${existing.id}`);
  }

  // Fetch work details for description + cover
  const work = await fetchOpenLibraryWork(result.key);
  const coverUrl =
    buildCoverUrl(result.cover_i, "L") ??
    buildCoverUrl(work.coverId, "L");

  // Insert book
  const [book] = await db
    .insert(books)
    .values({
      title: result.title,
      description: work.description,
      publicationYear: result.first_publish_year,
      isbn13: result.isbn?.find((i) => i.length === 13) ?? null,
      isbn10: result.isbn?.find((i) => i.length === 10) ?? null,
      pages: result.number_of_pages_median,
      coverImageUrl: coverUrl,
      openLibraryKey: result.key,
    })
    .returning();

  // Insert authors
  if (result.author_name?.length) {
    for (const name of result.author_name) {
      // Find or create author
      let author = await db.query.authors.findFirst({
        where: eq(authors.name, name),
      });
      if (!author) {
        [author] = await db.insert(authors).values({ name }).returning();
      }
      await db
        .insert(bookAuthors)
        .values({ bookId: book.id, authorId: author.id });
    }
  }

  redirect(`/book/${book.id}`);
}

export async function createBookManually(formData: FormData) {
  const title = formData.get("title") as string;
  const authorName = formData.get("author") as string;
  const description = (formData.get("description") as string) || null;
  const yearStr = formData.get("year") as string;
  const isbn13 = (formData.get("isbn13") as string) || null;
  const isbn10 = (formData.get("isbn10") as string) || null;
  const pagesStr = formData.get("pages") as string;

  if (!title?.trim()) {
    throw new Error("Title is required");
  }

  const [book] = await db
    .insert(books)
    .values({
      title: title.trim(),
      description,
      publicationYear: yearStr ? parseInt(yearStr, 10) : null,
      isbn13,
      isbn10,
      pages: pagesStr ? parseInt(pagesStr, 10) : null,
    })
    .returning();

  if (authorName?.trim()) {
    let author = await db.query.authors.findFirst({
      where: eq(authors.name, authorName.trim()),
    });
    if (!author) {
      [author] = await db
        .insert(authors)
        .values({ name: authorName.trim() })
        .returning();
    }
    await db
      .insert(bookAuthors)
      .values({ bookId: book.id, authorId: author.id });
  }

  redirect(`/book/${book.id}`);
}
