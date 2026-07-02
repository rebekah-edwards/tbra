"use server";

import { redirect } from "next/navigation";
import { parseFormats } from "@/lib/reading-formats";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userBookState, userOwnedEditions, books, userBookReviews, userBookDimensionRatings, reviewDescriptorTags, userBookRatings, readingSessions } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { importFromOpenLibraryAndReturn } from "@/lib/actions/books";
import { ensureReadingSession, pauseActiveSession, resumeActiveSession } from "@/lib/mutations/reading-session";
import { removeFromUpNext } from "@/lib/actions/up-next";
import { setBookStateFor } from "@/lib/mutations/reading-state";
import { getActiveSession } from "@/lib/queries/reading-session";
import type { OLSearchResult } from "@/lib/openlibrary";

export async function setBookState(bookId: string, state: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Shared user-scoped implementation (also used by /api/v1) — see
  // src/lib/mutations/reading-state.ts. Behavior is the exact former body
  // of this action.
  await setBookStateFor(user.userId, bookId, state);

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/");
}

export async function removeBookState(bookId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const existing = await db
    .select()
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, user.userId),
        eq(userBookState.bookId, bookId)
      )
    )
    .get();

  if (!existing) return;

  const formats = parseFormats(existing.ownedFormats);

  if (formats.length > 0) {
    // Keep the row for owned formats, just clear the state and active formats
    await db
      .update(userBookState)
      .set({ state: null, activeFormats: null, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(userBookState.userId, user.userId),
          eq(userBookState.bookId, bookId)
        )
      );
  } else {
    await db
      .delete(userBookState)
      .where(
        and(
          eq(userBookState.userId, user.userId),
          eq(userBookState.bookId, bookId)
        )
      );
  }

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/");
}

export async function setOwnedFormats(bookId: string, rawFormats: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // "unknown" is an import placeholder meaning "owned, format unspecified".
  // As soon as the user picks a real format it must be dropped — otherwise it
  // lingers alongside the real format and inflates the "Owned · N" count
  // (e.g. ["unknown","paperback"] showed as "Owned · 2").
  const formats = rawFormats.some((f) => f !== "unknown")
    ? rawFormats.filter((f) => f !== "unknown")
    : rawFormats;

  const existing = await db
    .select()
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, user.userId),
        eq(userBookState.bookId, bookId)
      )
    )
    .get();

  // Determine which formats were removed so we can clean up edition associations
  const previousFormats = parseFormats(existing?.ownedFormats);
  const removedFormats = previousFormats.filter((f) => !formats.includes(f));

  if (existing) {
    if (formats.length === 0 && !existing.state) {
      // No formats and no state — delete the row
      await db
        .delete(userBookState)
        .where(
          and(
            eq(userBookState.userId, user.userId),
            eq(userBookState.bookId, bookId)
          )
        );
    } else {
      await db
        .update(userBookState)
        .set({
          ownedFormats: formats.length > 0 ? JSON.stringify(formats) : null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(userBookState.userId, user.userId),
            eq(userBookState.bookId, bookId)
          )
        );
    }
  } else if (formats.length > 0) {
    await db.insert(userBookState).values({
      userId: user.userId,
      bookId,
      ownedFormats: JSON.stringify(formats),
    });
  }

  // Clean up edition associations for removed formats
  if (removedFormats.length > 0) {
    await db
      .delete(userOwnedEditions)
      .where(
        and(
          eq(userOwnedEditions.userId, user.userId),
          eq(userOwnedEditions.bookId, bookId),
          inArray(userOwnedEditions.format, removedFormats)
        )
      );
  }

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/");
}

/**
 * External search result from ISBNdb.
 * Passed to setBookStateWithImport when the user clicks a state button on a
 * book that came from /api/search/external.
 */
export interface ExternalBookImportInput {
  source: "isbndb";
  isbn: string;
  title: string;
  authors: string[];
  coverUrl?: string | null;
  publicationYear?: number | null;
  pages?: number | null;
}

export async function setBookStateWithImport(
  bookId: string | null,
  olResult: OLSearchResult | null,
  state: string,
  externalImport?: ExternalBookImportInput | null,
): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let resolvedBookId = bookId;

  // If no bookId, import from OL first
  if (!resolvedBookId && olResult) {
    // Check if already imported by OL key
    const existing = await db
      .select({ id: books.id })
      .from(books)
      .where(eq(books.openLibraryKey, olResult.key))
      .get();

    if (existing) {
      resolvedBookId = existing.id;
    } else {
      resolvedBookId = await importFromOpenLibraryAndReturn(olResult);
    }
  }

  // Or from ISBNdb if that's the source
  if (!resolvedBookId && externalImport?.source === "isbndb") {
    const { importFromISBNdbAndReturn } = await import("@/lib/actions/books");
    resolvedBookId = await importFromISBNdbAndReturn({
      isbn: externalImport.isbn,
      title: externalImport.title,
      authors: externalImport.authors,
      coverUrl: externalImport.coverUrl,
      publicationYear: externalImport.publicationYear,
      pages: externalImport.pages,
    });
  }

  if (!resolvedBookId) {
    throw new Error("No book ID and no import source provided");
  }

  // Now set the state
  const existingState = await db
    .select()
    .from(userBookState)
    .where(
      and(
        eq(userBookState.userId, user.userId),
        eq(userBookState.bookId, resolvedBookId)
      )
    )
    .get();

  if (existingState) {
    await db
      .update(userBookState)
      .set({ state, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(userBookState.userId, user.userId),
          eq(userBookState.bookId, resolvedBookId)
        )
      );
  } else {
    await db.insert(userBookState).values({
      userId: user.userId,
      bookId: resolvedBookId,
      state,
    });
  }

  // Remove from Up Next when starting to read
  if (state === "currently_reading") {
    await removeFromUpNext(resolvedBookId);
  }

  revalidatePath(`/book/${resolvedBookId}`);
  revalidatePath("/library");
  revalidatePath("/");

  return resolvedBookId;
}

export async function setActiveFormats(bookId: string, formats: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const formatsJson = formats.length > 0 ? JSON.stringify(formats) : null;

  await db
    .update(userBookState)
    .set({
      activeFormats: formatsJson,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(userBookState.userId, user.userId),
        eq(userBookState.bookId, bookId)
      )
    );

  // Mirror to the active reading session so stats (e.g. minutes-listened) can
  // see which formats were actually used. Without this, the session row keeps
  // the formats it had at session creation (often null) even after the user
  // picks a format mid-read.
  const active = await getActiveSession(user.userId, bookId);
  if (active) {
    await db
      .update(readingSessions)
      .set({ activeFormats: formatsJson, updatedAt: new Date().toISOString() })
      .where(eq(readingSessions.id, active.id));
  }

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/");
}

export async function addToTbr(bookId: string) {
  return setBookState(bookId, "tbr");
}

export async function removeFromLibrary(bookId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Delete review data (tags, dimension ratings, review, synced rating)
  const review = await db
    .select({ id: userBookReviews.id })
    .from(userBookReviews)
    .where(and(eq(userBookReviews.userId, user.userId), eq(userBookReviews.bookId, bookId)))
    .get();

  if (review) {
    await db.delete(reviewDescriptorTags).where(eq(reviewDescriptorTags.reviewId, review.id));
    await db.delete(userBookDimensionRatings).where(eq(userBookDimensionRatings.reviewId, review.id));
    await db.delete(userBookReviews).where(eq(userBookReviews.id, review.id));
  }

  await db
    .delete(userBookRatings)
    .where(and(eq(userBookRatings.userId, user.userId), eq(userBookRatings.bookId, bookId)));

  // Delete owned editions
  await db
    .delete(userOwnedEditions)
    .where(and(eq(userOwnedEditions.userId, user.userId), eq(userOwnedEditions.bookId, bookId)));

  // Delete reading sessions
  await db
    .delete(readingSessions)
    .where(and(eq(readingSessions.userId, user.userId), eq(readingSessions.bookId, bookId)));

  // Delete reading state row entirely
  await db
    .delete(userBookState)
    .where(and(eq(userBookState.userId, user.userId), eq(userBookState.bookId, bookId)));

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/");
}
