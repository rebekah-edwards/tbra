"use server";

import { db } from "@/db";
import { books, authors, bookAuthors, narrators, bookNarrators, genres, bookGenres } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  fetchOpenLibraryWork,
  fetchAuthorWorks,
  buildCoverUrl,
  normalizeGenres,
  type OLSearchResult,
} from "@/lib/openlibrary";
import { enrichBook } from "@/lib/enrichment/enrich-book";

const NONFICTION_GENRES = new Set([
  "Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime", "Philosophy",
]);

function detectIsFiction(genreNames: string[]): boolean {
  return !genreNames.some((g) => NONFICTION_GENRES.has(g));
}

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
  // Prefer work cover (usually canonical hardcover) over search cover (often audiobook)
  const coverUrl =
    buildCoverUrl(work.coverId, "L") ??
    buildCoverUrl(result.cover_i, "L");

  // Normalize genres first so we can detect fiction/nonfiction
  const genreNames = normalizeGenres(work.subjects);
  const isFiction = detectIsFiction(genreNames);

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
      isFiction,
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

  // Insert genres
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

  // Enrich with content ratings, summary, tags (non-blocking)
  enrichBook(book.id).catch((err) => {
    console.error("[enrichment] Error:", err);
  });

  // Cascade: import other books by these authors (non-blocking)
  if (authorOlKeys.length > 0) {
    importCascadeBooks(authorOlKeys).catch((err) => {
      console.error("Cascade import error:", err);
    });
  }

  redirect(`/book/${book.id}`);
}

// Same as importFromOpenLibrary but returns book ID instead of redirecting
export async function importFromOpenLibraryAndReturn(result: OLSearchResult): Promise<string> {
  // Check if already imported
  const existing = await db.query.books.findFirst({
    where: eq(books.openLibraryKey, result.key),
  });
  if (existing) {
    return existing.id;
  }

  const work = await fetchOpenLibraryWork(result.key);
  const coverUrl =
    buildCoverUrl(work.coverId, "L") ??
    buildCoverUrl(result.cover_i, "L");

  const genreNames = normalizeGenres(work.subjects);
  const isFiction = detectIsFiction(genreNames);

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
      isFiction,
    })
    .returning();

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

  // Enrich with content ratings, summary, tags (non-blocking)
  enrichBook(book.id).catch((err) => {
    console.error("[enrichment] Error:", err);
  });

  if (authorOlKeys.length > 0) {
    importCascadeBooks(authorOlKeys).catch((err) => {
      console.error("Cascade import error:", err);
    });
  }

  return book.id;
}

export async function createBookManually(formData: FormData) {
  const title = formData.get("title") as string;
  const authorName = formData.get("author") as string;
  const description = (formData.get("description") as string) || null;
  const yearStr = formData.get("year") as string;
  const isbn13 = (formData.get("isbn13") as string) || null;
  const isbn10 = (formData.get("isbn10") as string) || null;
  const pagesStr = formData.get("pages") as string;
  let coverImageUrl = (formData.get("coverImageUrl") as string) || null;
  const audioLengthStr = formData.get("audioLengthMinutes") as string;
  const isFictionVal = formData.get("isFiction") as string;
  const narratorName = formData.get("narrator") as string;

  if (!title?.trim()) {
    throw new Error("Title is required");
  }

  // Handle cover file upload
  const coverFile = formData.get("coverFile") as File | null;
  if (coverFile && coverFile.size > 0) {
    const ext = coverFile.name.split(".").pop()?.toLowerCase() || "jpg";
    const allowedExts = ["jpg", "jpeg", "png", "webp"];
    if (!allowedExts.includes(ext)) throw new Error("Invalid image type");
    if (coverFile.size > 1024 * 1024) throw new Error("Cover image must be under 1 MB");

    const filename = `cover-${Date.now()}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "covers");
    await mkdir(uploadDir, { recursive: true });
    const buffer = Buffer.from(await coverFile.arrayBuffer());
    await writeFile(path.join(uploadDir, filename), buffer);
    coverImageUrl = `/uploads/covers/${filename}`;
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
      coverImageUrl,
      audioLengthMinutes: audioLengthStr ? parseInt(audioLengthStr, 10) : null,
      isFiction: isFictionVal !== "nonfiction",
    })
    .returning();

  if (authorName?.trim()) {
    const authorId = await findOrCreateAuthor(authorName.trim());
    await db
      .insert(bookAuthors)
      .values({ bookId: book.id, authorId });
  }

  if (narratorName?.trim()) {
    let narrator = await db.query.narrators.findFirst({
      where: eq(narrators.name, narratorName.trim()),
    });
    if (!narrator) {
      [narrator] = await db
        .insert(narrators)
        .values({ name: narratorName.trim() })
        .returning();
    }
    await db
      .insert(bookNarrators)
      .values({ bookId: book.id, narratorId: narrator.id });
  }

  // Enrich with content ratings, summary, tags (non-blocking)
  enrichBook(book.id).catch((err) => {
    console.error("[enrichment] Error:", err);
  });

  redirect(`/book/${book.id}`);
}
