"use server";

import { db } from "@/db";
import { userHiddenBooks, books, bookAuthors, authors } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function hideBook(bookId: string): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };

  // Check if already hidden
  const existing = await db
    .select({ bookId: userHiddenBooks.bookId })
    .from(userHiddenBooks)
    .where(and(eq(userHiddenBooks.userId, session.userId), eq(userHiddenBooks.bookId, bookId)))
    .get();

  if (existing) return { success: true };

  await db.insert(userHiddenBooks).values({
    userId: session.userId,
    bookId,
  });

  revalidatePath("/");
  revalidatePath("/discover");
  revalidatePath(`/book/${bookId}`);
  revalidatePath("/settings");
  return { success: true };
}

export async function unhideBook(bookId: string): Promise<{ success: boolean }> {
  const session = await getCurrentUser();
  if (!session) return { success: false };

  await db
    .delete(userHiddenBooks)
    .where(and(eq(userHiddenBooks.userId, session.userId), eq(userHiddenBooks.bookId, bookId)));

  revalidatePath("/");
  revalidatePath("/discover");
  revalidatePath(`/book/${bookId}`);
  revalidatePath("/settings");
  return { success: true };
}

export async function getHiddenBookIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ bookId: userHiddenBooks.bookId })
    .from(userHiddenBooks)
    .where(eq(userHiddenBooks.userId, userId))
    .all();

  return new Set(rows.map((r) => r.bookId));
}

export async function isBookHidden(userId: string, bookId: string): Promise<boolean> {
  const row = await db
    .select({ bookId: userHiddenBooks.bookId })
    .from(userHiddenBooks)
    .where(and(eq(userHiddenBooks.userId, userId), eq(userHiddenBooks.bookId, bookId)))
    .get();

  return !!row;
}

export async function getHiddenBooks(userId: string): Promise<
  { bookId: string; title: string; coverImageUrl: string | null; authors: string[] }[]
> {
  const rows = await db
    .select({
      bookId: userHiddenBooks.bookId,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
    })
    .from(userHiddenBooks)
    .innerJoin(books, eq(userHiddenBooks.bookId, books.id))
    .where(eq(userHiddenBooks.userId, userId))
    .all();

  // Fetch authors for each hidden book
  const bookIds = rows.map((r) => r.bookId);
  if (bookIds.length === 0) return [];

  const authorRows = await db
    .select({
      bookId: bookAuthors.bookId,
      authorName: authors.name,
    })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(inArray(bookAuthors.bookId, bookIds))
    .all();

  const authorMap = new Map<string, string[]>();
  for (const ar of authorRows) {
    const list = authorMap.get(ar.bookId) || [];
    list.push(ar.authorName);
    authorMap.set(ar.bookId, list);
  }

  return rows.map((r) => ({
    bookId: r.bookId,
    title: r.title,
    coverImageUrl: r.coverImageUrl,
    authors: authorMap.get(r.bookId) || [],
  }));
}
