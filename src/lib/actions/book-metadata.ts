"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { books } from "@/db/schema";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/**
 * Saves a book's page count or audio length from /admin/book-metadata.
 * Gated by isAdmin — the same test as the page itself — so anyone who can
 * see the list can save (updateBookFields checks role only, and one super
 * admin has role 'user'). Writes the CATALOG row and bumps updated_at so the
 * fix is permanent and rides the live↔local sync.
 */
export async function saveBookLength(
  bookId: string,
  fields: { pages?: number; audioLengthMinutes?: number },
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { success: false, error: "Unauthorized" };

  const set: { pages?: number; audioLengthMinutes?: number; updatedAt: string } = {
    updatedAt: new Date().toISOString(),
  };
  if (fields.pages !== undefined) {
    const p = Math.round(fields.pages);
    if (!Number.isFinite(p) || p < 1 || p > 20000) return { success: false, error: "Pages must be 1–20,000." };
    set.pages = p;
  }
  if (fields.audioLengthMinutes !== undefined) {
    const m = Math.round(fields.audioLengthMinutes);
    if (!Number.isFinite(m) || m < 1 || m > 200 * 60) return { success: false, error: "Length must be 1 minute to 200 hours." };
    set.audioLengthMinutes = m;
  }
  if (set.pages === undefined && set.audioLengthMinutes === undefined) return { success: false, error: "Nothing to save." };

  const row = await db.query.books.findFirst({ where: eq(books.id, bookId), columns: { id: true, slug: true } });
  if (!row) return { success: false, error: "Book not found." };

  await db.update(books).set(set).where(eq(books.id, bookId));
  revalidatePath(`/book/${bookId}`);
  if (row.slug) revalidatePath(`/book/${row.slug}`);
  revalidatePath("/stats");
  return { success: true };
}
