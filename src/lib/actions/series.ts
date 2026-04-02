"use server";

import { db } from "@/db";
import { series, books } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function toggleSeriesCoverStyle(
  seriesId: string
): Promise<{ success: boolean; coverStyle: string }> {
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false, coverStyle: "default" };

  const row = await db
    .select({ coverStyle: series.coverStyle })
    .from(series)
    .where(eq(series.id, seriesId))
    .get();

  if (!row) return { success: false, coverStyle: "default" };

  const newStyle = row.coverStyle === "format" ? "default" : "format";

  await db
    .update(series)
    .set({ coverStyle: newStyle })
    .where(eq(series.id, seriesId));

  revalidatePath(`/search`);
  return { success: true, coverStyle: newStyle };
}

export async function setSeriesCover(
  bookId: string,
  coverUrl: string | null
): Promise<{ success: boolean }> {
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false };

  await db
    .update(books)
    .set({ seriesCoverUrl: coverUrl || null })
    .where(eq(books.id, bookId));

  revalidatePath(`/search`);
  return { success: true };
}

/**
 * Set or clear the parent franchise for a series.
 * Single-level enforcement: a series that is already a parent cannot become a child.
 */
export async function setParentSeries(
  seriesId: string,
  parentSeriesId: string | null
): Promise<{ success: boolean; error?: string }> {
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false, error: "Not authorized" };

  if (parentSeriesId) {
    // Can't parent to self
    if (parentSeriesId === seriesId) return { success: false, error: "Cannot parent a series to itself" };

    // Verify parent exists
    const parent = await db.select({ id: series.id, parentSeriesId: series.parentSeriesId }).from(series).where(eq(series.id, parentSeriesId)).get();
    if (!parent) return { success: false, error: "Parent series not found" };

    // Single-level: parent must not itself have a parent
    if (parent.parentSeriesId) return { success: false, error: "Cannot nest more than one level deep" };
  }

  await db.update(series).set({ parentSeriesId }).where(eq(series.id, seriesId));

  revalidatePath(`/series`);
  return { success: true };
}

/**
 * Search series eligible to be franchise parents (no parent themselves).
 */
export async function searchSeriesForParent(query: string): Promise<{ id: string; name: string; slug: string | null }[]> {
  const session = await getCurrentUser();
  if (session?.role !== "admin") return [];

  const sql = await import("drizzle-orm").then(m => m.sql);
  const isNull = await import("drizzle-orm").then(m => m.isNull);

  const results = await db
    .select({ id: series.id, name: series.name, slug: series.slug })
    .from(series)
    .where(sql`LOWER(${series.name}) LIKE ${`%${query.toLowerCase()}%`} AND ${series.parentSeriesId} IS NULL`)
    .limit(10);

  return results;
}
