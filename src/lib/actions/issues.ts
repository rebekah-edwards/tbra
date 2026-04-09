"use server";

import { db } from "@/db";
import { reportedIssues, books, series } from "@/db/schema";
import { eq, sql, or } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export async function submitIssue(data: {
  bookId?: string;
  bookSlug?: string;
  seriesId?: string;
  seriesSlug?: string;
  pageUrl: string;
  description: string;
}): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Must be logged in" };

  if (!data.description.trim()) {
    return { success: false, error: "Description is required" };
  }

  // Resolve bookId from slug if not provided directly
  let bookId = data.bookId ?? null;
  if (!bookId && data.bookSlug) {
    const book = await db
      .select({ id: books.id })
      .from(books)
      .where(or(eq(books.slug, data.bookSlug), eq(books.id, data.bookSlug)))
      .get();
    bookId = book?.id ?? null;
  }

  // Resolve seriesId from slug if not provided directly
  let seriesId = data.seriesId ?? null;
  if (!seriesId && data.seriesSlug) {
    const s = await db
      .select({ id: series.id })
      .from(series)
      .where(or(eq(series.slug, data.seriesSlug), eq(series.id, data.seriesSlug)))
      .get();
    seriesId = s?.id ?? null;
  }

  await db.insert(reportedIssues).values({
    userId: user.userId,
    bookId,
    seriesId,
    pageUrl: data.pageUrl,
    description: data.description.trim(),
  });

  return { success: true };
}

export async function resolveIssue(
  issueId: string,
  status: "in_progress" | "resolved" | "wontfix",
  resolution?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { success: false, error: "Unauthorized" };

  const updates: Record<string, unknown> = { status };

  if (status === "resolved" || status === "wontfix") {
    updates.resolvedAt = sql`datetime('now')`;
    if (resolution) updates.resolution = resolution;
  }

  await db.update(reportedIssues).set(updates).where(eq(reportedIssues.id, issueId));

  return { success: true };
}

export async function deleteIssue(
  issueId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { success: false, error: "Unauthorized" };

  await db.delete(reportedIssues).where(eq(reportedIssues.id, issueId));

  return { success: true };
}
