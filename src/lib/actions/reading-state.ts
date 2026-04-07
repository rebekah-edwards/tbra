"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userBookState, userOwnedEditions, books, userBookReviews, userBookDimensionRatings, reviewDescriptorTags, userBookRatings, readingSessions } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { importFromOpenLibraryAndReturn } from "@/lib/actions/books";
import { ensureReadingSession, pauseActiveSession } from "@/lib/actions/reading-session";
import { removeFromUpNext } from "@/lib/actions/up-next";
import { getActiveSession } from "@/lib/queries/reading-session";
import type { OLSearchResult } from "@/lib/openlibrary";

export async function setBookState(bookId: string, state: string) {
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

  // Preserve activeFormats when entering currently_reading, clear when leaving
  // If entering with exactly one owned format, pre-select it
  let activeFormats: string | null = null;
  if (state === "currently_reading") {
    if (existing?.activeFormats) {
      activeFormats = existing.activeFormats;
    } else {
      const formats = existing?.ownedFormats
        ? (JSON.parse(existing.ownedFormats) as string[])
        : [];
      if (formats.length === 1) {
        activeFormats = JSON.stringify(formats);
      }
    }
  }

  if (existing) {
    await db
      .update(userBookState)
      .set({ state, activeFormats, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(userBookState.userId, user.userId),
          eq(userBookState.bookId, bookId)
        )
      );
  } else {
    await db.insert(userBookState).values({
      userId: user.userId,
      bookId,
      state,
      activeFormats,
    });
  }

  // Remove from Up Next when starting to read
  if (state === "currently_reading") {
    await removeFromUpNext(bookId);
  }

  // Sync reading session
  if (state === "currently_reading") {
    await ensureReadingSession(user.userId, bookId, activeFormats);
  } else if (state === "paused") {
    // Ensure a reading session exists before pausing — if a book goes straight
    // to "paused" (e.g., imported without a session), create one first so
    // the reader has a start date, then pause it.
    await ensureReadingSession(user.userId, bookId, activeFormats);
    await pauseActiveSession(user.userId, bookId);
  }
  // Note: "completed" and "dnf" are handled by setBookStateWithCompletion (called from UI with date info)
  // "tbr" doesn't need a session

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

  const formats = existing.ownedFormats
    ? (JSON.parse(existing.ownedFormats) as string[])
    : [];

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

export async function setOwnedFormats(bookId: string, formats: string[]) {
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

  // Determine which formats were removed so we can clean up edition associations
  const previousFormats = existing?.ownedFormats
    ? (JSON.parse(existing.ownedFormats) as string[])
    : [];
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

  await db
    .update(userBookState)
    .set({
      activeFormats: formats.length > 0 ? JSON.stringify(formats) : null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(userBookState.userId, user.userId),
        eq(userBookState.bookId, bookId)
      )
    );

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
