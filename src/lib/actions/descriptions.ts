"use server";

import { db } from "@/db";
import { books } from "@/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { isEnglishDescription } from "@/lib/text/description-language";
import { sanitizeDescription } from "@/lib/enrichment/sanitize";

/** Generous ceiling — the longest description in the catalog is ~4k chars. */
const MAX_INPUT_CHARS = 20_000;

/** sanitizeDescription() rejects anything shorter than this after cleanup. */
const MIN_DESCRIPTION_CHARS = 60;

export type SaveDescriptionResult =
  | {
      success: true;
      /** Length of what was actually stored, after the sanitizer ran. */
      savedLength: number;
      /** Length of what was submitted (trimmed), to show how much was cut. */
      inputLength: number;
    }
  | {
      success: false;
      error: string;
      /** True when the book no longer belongs in the queue (already filled,
       *  or gone) — the client should drop the row rather than keep retrying. */
      gone?: boolean;
    };

/**
 * Save a hand-entered description from the /admin/descriptions queue.
 *
 * - Admin only (same check as the cover queue).
 * - The text goes through sanitizeDescription() — the same gate every
 *   automated source has to pass — so a pasted Goodreads review page or an
 *   Amazon listing header is rejected here instead of going live.
 * - Writes description + description_stale=0 and bumps updated_at so the edit
 *   rides the live↔local sync (sync-pull applies the newer live row locally).
 * - Only writes while the book still needs a description, so a stale tab can
 *   never overwrite a description that landed in the meantime.
 *
 * `books` has no description-source column, so there is nowhere to record
 * that this text was entered by hand.
 */
export async function saveManualDescription(
  bookId: string,
  text: string,
): Promise<SaveDescriptionResult> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return { success: false, error: "Admin only" };
  }

  if (typeof bookId !== "string" || !bookId || typeof text !== "string") {
    return { success: false, error: "Invalid request" };
  }

  const input = text.replace(/\r\n?/g, "\n").trim();
  if (!input) {
    return { success: false, error: "Description is required" };
  }
  if (input.length > MAX_INPUT_CHARS) {
    return {
      success: false,
      error: `Too long — ${input.length.toLocaleString()} characters (limit ${MAX_INPUT_CHARS.toLocaleString()}).`,
    };
  }

  const clean = sanitizeDescription(input);
  if (!clean) {
    return {
      success: false,
      error:
        input.length < MIN_DESCRIPTION_CHARS
          ? `Too short — a description needs at least ${MIN_DESCRIPTION_CHARS} characters.`
          : !isEnglishDescription(input)
            ? "Not saved — this description isn't in English. Paste the English-language " +
              "publisher description instead."
            : "Not saved — the description filter rejected this text. It turns away " +
            "review-page scrapes (Goodreads or Amazon page text, reader reviews), " +
            "stacks of review quotes, author bios, tables of contents and seller " +
            "listings, and anything under 60 characters once those are removed. " +
            "Paste the publisher's own description of the book instead.",
    };
  }

  const book = await db
    .select({ id: books.id, slug: books.slug })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  if (!book) {
    return { success: false, error: "Book not found", gone: true };
  }

  // Same three conditions as the queue's selector (and the description-refresh
  // lane's): only fill a description that is flagged stale, NULL or blank.
  const written = await db
    .update(books)
    .set({
      description: clean,
      descriptionStale: false,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(books.id, bookId),
        or(
          eq(books.descriptionStale, true),
          isNull(books.description),
          sql`TRIM(${books.description}) = ''`,
        ),
      ),
    )
    .returning({ id: books.id });

  if (written.length === 0) {
    // Refresh the list so the already-filled row drops out for everyone.
    revalidatePath("/admin/descriptions");
    return {
      success: false,
      error: "This book already has a description — nothing was changed.",
      gone: true,
    };
  }

  // Any revalidatePath inside a server action makes Next re-render the page
  // the action was called from in the same response, so the queue refills and
  // the counts update without a separate refresh round-trip.
  revalidatePath("/admin/descriptions");
  if (book.slug) revalidatePath(`/book/${book.slug}`);

  return { success: true, savedLength: clean.length, inputLength: input.length };
}
