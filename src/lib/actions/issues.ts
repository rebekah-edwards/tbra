"use server";

import { db } from "@/db";
import { reportedIssues } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export async function submitIssue(data: {
  bookId?: string;
  seriesId?: string;
  pageUrl: string;
  description: string;
}): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Must be logged in" };

  if (!data.description.trim()) {
    return { success: false, error: "Description is required" };
  }

  await db.insert(reportedIssues).values({
    userId: user.userId,
    bookId: data.bookId ?? null,
    seriesId: data.seriesId ?? null,
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
