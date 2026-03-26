"use server";

import { db } from "@/db";
import { landingPageBooks, books } from "@/db/schema";
import { eq, and, like, isNotNull, sql } from "drizzle-orm";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getLandingBooks() {
  return db
    .select({
      id: landingPageBooks.id,
      bookSlug: landingPageBooks.bookSlug,
      type: landingPageBooks.type,
      sortOrder: landingPageBooks.sortOrder,
      // Join book data
      bookTitle: books.title,
      coverImageUrl: books.coverImageUrl,
    })
    .from(landingPageBooks)
    .leftJoin(books, eq(landingPageBooks.bookSlug, books.slug))
    .orderBy(landingPageBooks.type, landingPageBooks.sortOrder);
}

export async function addLandingBook(slug: string, type: string = "parade") {
  const user = await getCurrentUser();
  if (!user || !isSuperAdmin(user)) throw new Error("Unauthorized");

  // Check if already exists
  const existing = await db
    .select()
    .from(landingPageBooks)
    .where(and(eq(landingPageBooks.bookSlug, slug), eq(landingPageBooks.type, type)));

  if (existing.length > 0) return { error: "Already added" };

  // Get max sort order
  const maxOrder = await db
    .select({ max: sql<number>`COALESCE(MAX(sort_order), -1)` })
    .from(landingPageBooks)
    .where(eq(landingPageBooks.type, type));

  await db.insert(landingPageBooks).values({
    bookSlug: slug,
    type,
    sortOrder: (maxOrder[0]?.max ?? -1) + 1,
  });

  revalidatePath("/");
  revalidatePath("/admin/landing");
  return { success: true };
}

export async function removeLandingBook(id: string) {
  const user = await getCurrentUser();
  if (!user || !isSuperAdmin(user)) throw new Error("Unauthorized");

  await db.delete(landingPageBooks).where(eq(landingPageBooks.id, id));

  revalidatePath("/");
  revalidatePath("/admin/landing");
  return { success: true };
}

export async function setFeaturedBook(slug: string) {
  const user = await getCurrentUser();
  if (!user || !isSuperAdmin(user)) throw new Error("Unauthorized");

  // Remove existing featured
  await db.delete(landingPageBooks).where(eq(landingPageBooks.type, "featured"));

  // Add new featured
  await db.insert(landingPageBooks).values({
    bookSlug: slug,
    type: "featured",
    sortOrder: 0,
  });

  revalidatePath("/");
  revalidatePath("/admin/landing");
  return { success: true };
}

export async function searchBooksForLanding(query: string) {
  if (!query || query.length < 2) return [];

  return db
    .select({
      slug: books.slug,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
    })
    .from(books)
    .where(
      and(
        like(books.title, `%${query}%`),
        isNotNull(books.slug),
        isNotNull(books.coverImageUrl),
        eq(books.coverVerified, true),
        eq(books.visibility, "public"),
      )
    )
    .limit(20);
}
