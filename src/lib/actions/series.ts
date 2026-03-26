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
