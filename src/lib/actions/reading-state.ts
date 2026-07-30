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
import {
  setBookStateFor,
  removeBookStateFor,
  removeFromLibraryFor,
  setOwnedFormatsFor,
  setActiveFormatsFor,
} from "@/lib/mutations/reading-state";
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

  // Shared user-scoped implementation (also used by /api/v1).
  await removeBookStateFor(user.userId, bookId);

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/");
}

export async function setOwnedFormats(bookId: string, rawFormats: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Shared user-scoped implementation (also used by /api/v1) — includes the
  // "unknown" placeholder rule and edition-association cleanup.
  await setOwnedFormatsFor(user.userId, bookId, rawFormats);

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
  /** Upstream language value, so the import junk gate can act on it. */
  language?: string | null;
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
      language: externalImport.language,
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

  // Shared user-scoped implementation (also used by /api/v1) — mirrors the
  // selection onto the active reading session for stats.
  await setActiveFormatsFor(user.userId, bookId, formats);

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

  // Shared user-scoped implementation (also used by /api/v1): deletes review
  // data (tags, dimension ratings, review, synced rating), owned editions,
  // reading sessions, and the state row.
  await removeFromLibraryFor(user.userId, bookId);

  revalidatePath(`/book/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/");
}
