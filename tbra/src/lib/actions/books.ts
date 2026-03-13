"use server";

import { db } from "@/db";
import { books, authors, bookAuthors, genres, bookGenres } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  fetchOpenLibraryWork,
  fetchAuthorWorks,
  buildCoverUrl,
  normalizeGenres,
  type OLSearchResult,
} from "@/lib/openlibrary";

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findOrCreateAuthor(
  name: string,
  olKey?: string
): Promise<string> {
  let author = await db.query.authors.findFirst({
    where: eq(authors.name, name),
  });
  if (author) {
    // Update OL key if we have one and author doesn't
    if (olKey && !author.openLibraryKey) {
      await db
        .update(authors)
        .set({ openLibraryKey: olKey })
        .where(eq(authors.id, author.id));
    }
    return author.id;
  }
  const [created] = await db
    .insert(authors)
    .values({ name, openLibraryKey: olKey ?? null })
    .returning();
  return created.id;
}

async function importCascadeBooks(authorOlKeys: string[]) {
  for (const authorKey of authorOlKeys) {
    await delay(350);
    const works = await fetchAuthorWorks(authorKey);

    for (const work of works) {
      // Skip if already imported
      const workKey = work.key; // e.g. "/works/OL12345W"
      const existing = await db.query.books.findFirst({
        where: eq(books.openLibraryKey, workKey),
      });
      if (existing) continue;

      // Import with minimal metadata (title + cover only)
      const coverUrl = buildCoverUrl(work.covers?.[0], "L");

      await delay(350);
      const [newBook] = await db
        .insert(books)
        .values({
          title: work.title,
          coverImageUrl: coverUrl,
          openLibraryKey: workKey,
        })
        .returning();

      // Link to the author
      const author = await db.query.authors.findFirst({
        where: eq(authors.openLibraryKey, authorKey),
      });
      if (author) {
        await db
          .insert(bookAuthors)
          .values({ bookId: newBook.id, authorId: author.id })
          .onConflictDoNothing();
      }
    }
  }
}

export async function importFromOpenLibrary(result: OLSearchResult) {
  // Check if already imported
  const existing = await db.query.books.findFirst({
    where: eq(books.openLibraryKey, result.key),
  });
  if (existing) {
    redirect(`/book/${existing.id}`);
  }

  // Fetch work details for description + cover + subjects
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

  // Insert authors (with OL keys)
  const authorOlKeys: string[] = [];
  if (result.author_name?.length) {
    for (let i = 0; i < result.author_name.length; i++) {
      const name = result.author_name[i];
      const olKey = result.author_key?.[i];
      const authorId = await findOrCreateAuthor(name, olKey);
      await db
        .insert(bookAuthors)
        .values({ bookId: book.id, authorId });
      if (olKey) authorOlKeys.push(olKey);
    }
  }

  // Insert genres from OL subjects
  const genreNames = normalizeGenres(work.subjects);
  for (const genreName of genreNames) {
    let genre = await db.query.genres.findFirst({
      where: eq(genres.name, genreName),
    });
    if (!genre) {
      [genre] = await db.insert(genres).values({ name: genreName }).returning();
    }
    await db
      .insert(bookGenres)
      .values({ bookId: book.id, genreId: genre.id });
  }

  // Cascade: import other books by these authors (non-blocking)
  if (authorOlKeys.length > 0) {
    importCascadeBooks(authorOlKeys).catch((err) => {
      console.error("Cascade import error:", err);
    });
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
    const authorId = await findOrCreateAuthor(authorName.trim());
    await db
      .insert(bookAuthors)
      .values({ bookId: book.id, authorId });
  }

  redirect(`/book/${book.id}`);
}
