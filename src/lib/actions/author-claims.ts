"use server";

import { getCurrentUser, isAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  submitAuthorClaimFor,
  reviewAuthorClaimFor,
  staffLinkAuthorFor,
  revertAuthorEditFor,
  authorEditDescriptionFor,
  authorRateFor,
} from "@/lib/authors/claims";

type R = { success: boolean; error?: string };

export async function claimAuthorPage(
  authorId: string,
  input: { contactEmail?: string; evidenceLinks?: string; message?: string },
): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Sign in to claim this page" };
  const res = await submitAuthorClaimFor(user.userId, authorId, input);
  return res.success ? { success: true } : res;
}

export async function adminReviewAuthorClaim(
  claimId: string,
  decision: "approved" | "rejected" | "revoked",
  note?: string,
): Promise<R> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { success: false, error: "Unauthorized" };
  const res = await reviewAuthorClaimFor(user.userId, claimId, decision, note);
  revalidatePath("/admin/authors");
  return res.success ? { success: true } : res;
}

export async function adminLinkAuthorAccount(username: string, author: string, note?: string): Promise<R> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { success: false, error: "Unauthorized" };
  const res = await staffLinkAuthorFor(user.userId, username, author, note);
  revalidatePath("/admin/authors");
  return res.success ? { success: true } : res;
}

export async function adminRevertAuthorEdit(editId: string): Promise<R> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { success: false, error: "Unauthorized" };
  const res = await revertAuthorEditFor(user.userId, editId);
  revalidatePath("/admin/authors");
  return res.success ? { success: true } : res;
}

export async function authorSaveDescription(bookId: string, description: string): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not signed in" };
  const res = await authorEditDescriptionFor(user.userId, bookId, description);
  return res.success ? { success: true } : res;
}

export async function authorSaveRating(
  bookId: string,
  categoryKey: string,
  intensity: number | null,
  notes: string | null | undefined,
): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not signed in" };
  const res = await authorRateFor(user.userId, bookId, categoryKey, { intensity, notes });
  return res.success ? { success: true } : res;
}
