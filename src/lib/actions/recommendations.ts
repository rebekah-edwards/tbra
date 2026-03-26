"use server";

import { getCurrentUser } from "@/lib/auth";
import { getPostCompletionSuggestions } from "@/lib/queries/recommendations";
import type { RecommendedBook } from "@/lib/queries/recommendations";

export async function fetchPostCompletionSuggestions(
  bookId: string
): Promise<{
  seriesNext: RecommendedBook | null;
  similarBooks: RecommendedBook[];
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  return getPostCompletionSuggestions(user.userId, bookId);
}
