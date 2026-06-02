"use server";

import { db } from "@/db";
import { books, bookAuthors, authors } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { findNytMatch } from "@/lib/enrichment/nyt";
import { revalidatePath } from "next/cache";

export async function saveManualCover(
  bookId: string,
  coverUrl: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return { success: false, error: "Admin only" };
  }

  const trimmed = coverUrl.trim();
  if (!trimmed) {
    return { success: false, error: "URL is required" };
  }

  // Basic URL sanity check — must be http(s) and look like an image host
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { success: false, error: "URL must use http or https" };
    }
  } catch {
    return { success: false, error: "Invalid URL" };
  }

  await db
    .update(books)
    .set({
      coverImageUrl: trimmed,
      coverVerified: true,
      coverSource: "manual",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(books.id, bookId));

  revalidatePath("/admin/covers");
  // Also revalidate the book page so the new cover shows immediately
  const row = await db
    .select({ slug: books.slug })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  if (row?.slug) revalidatePath(`/book/${row.slug}`);

  return { success: true };
}

/**
 * Apply the NYT bestseller cover for a book. Re-derives the NYT cover URL
 * server-side from the nyt_bestsellers cache (matched by ISBN-13 → title|author),
 * so the admin's one click is authoritative and can't be spoofed by a client URL.
 * Tags the result cover_source='nyt' so it's distinguishable from manual pastes.
 */
export async function saveNytCover(
  bookId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return { success: false, error: "Admin only" };
  }

  const book = await db
    .select({ id: books.id, title: books.title, isbn13: books.isbn13, slug: books.slug })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  if (!book) return { success: false, error: "Book not found" };

  const authorRow = await db
    .select({ name: authors.name })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(eq(bookAuthors.bookId, bookId))
    .get();

  const nyt = await findNytMatch({
    isbn13: book.isbn13,
    title: book.title,
    author: authorRow?.name ?? null,
  });
  if (!nyt?.bookImage) {
    return { success: false, error: "No NYT cover available for this book" };
  }

  await db
    .update(books)
    .set({
      coverImageUrl: nyt.bookImage,
      coverVerified: true,
      coverSource: "nyt",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(books.id, bookId));

  revalidatePath("/admin/covers");
  if (book.slug) revalidatePath(`/book/${book.slug}`);
  return { success: true };
}

/**
 * Archive a book — sets visibility='hidden' (reversible, preserves data).
 * Use this for books that are effectively junk but have some user activity
 * or would be noisy to hard-delete. For true junk with zero users, use the
 * /admin/issues triage flow which does full FK cleanup.
 */
export async function archiveBook(
  bookId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return { success: false, error: "Admin only" };
  }

  await db
    .update(books)
    .set({
      visibility: "hidden",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(books.id, bookId));

  revalidatePath("/admin/covers");
  return { success: true };
}
