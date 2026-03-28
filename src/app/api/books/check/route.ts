import { NextResponse } from "next/server";
import { db } from "@/db";
import { books, userBookState, userOwnedEditions, editions } from "@/db/schema";
import { inArray, eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveCoverUrl } from "@/lib/covers";

export async function POST(request: Request) {
  const { keys } = (await request.json()) as { keys: string[] };

  if (!keys?.length) {
    return NextResponse.json({ existing: {}, states: {}, ownedFormats: {}, covers: {} });
  }

  // Split keys into OL keys and local book IDs
  const olKeys: string[] = [];
  const localBookIds: string[] = [];
  for (const key of keys) {
    if (key.startsWith("local:")) {
      localBookIds.push(key.slice(6)); // strip "local:" prefix
    } else {
      olKeys.push(key);
    }
  }

  const existing: Record<string, string> = {};
  const bookIdToKey: Record<string, string> = {};
  const bookIdToCover: Record<string, string | null> = {};

  // Look up by OL key
  if (olKeys.length > 0) {
    const rows = await db
      .select({
        id: books.id,
        title: books.title,
        openLibraryKey: books.openLibraryKey,
        coverImageUrl: books.coverImageUrl,
        isBoxSet: books.isBoxSet,
      })
      .from(books)
      .where(inArray(books.openLibraryKey, olKeys))
      .all();

    for (const row of rows) {
      // Skip box sets / collections — don't surface them as "existing" in search
      if (row.openLibraryKey && !row.isBoxSet) {
        existing[row.openLibraryKey] = row.id;
        bookIdToKey[row.id] = row.openLibraryKey;
        bookIdToCover[row.id] = row.coverImageUrl;
      }
    }
  }

  // Look up local books by ID
  if (localBookIds.length > 0) {
    const localRows = await db
      .select({
        id: books.id,
        coverImageUrl: books.coverImageUrl,
      })
      .from(books)
      .where(inArray(books.id, localBookIds))
      .all();

    for (const row of localRows) {
      const localKey = `local:${row.id}`;
      existing[localKey] = row.id;
      bookIdToKey[row.id] = localKey;
      bookIdToCover[row.id] = row.coverImageUrl;
    }
  }

  // Also return reading states, owned formats, and effective covers for the current user
  const states: Record<string, string> = {};
  const ownedFormats: Record<string, string[]> = {};
  const covers: Record<string, string> = {};
  const user = await getCurrentUser();

  if (user) {
    const bookIds = Object.values(existing);
    if (bookIds.length > 0) {
      const stateRows = await db
        .select({
          bookId: userBookState.bookId,
          state: userBookState.state,
          ownedFormats: userBookState.ownedFormats,
          activeFormats: userBookState.activeFormats,
        })
        .from(userBookState)
        .where(
          and(
            eq(userBookState.userId, user.userId),
            inArray(userBookState.bookId, bookIds)
          )
        )
        .all();

      // Build state/format maps
      const stateByBookId: Record<string, typeof stateRows[0]> = {};
      for (const row of stateRows) {
        const olKey = bookIdToKey[row.bookId];
        if (olKey && row.state) {
          states[olKey] = row.state;
        }
        if (olKey && row.ownedFormats) {
          ownedFormats[olKey] = JSON.parse(row.ownedFormats) as string[];
        }
        stateByBookId[row.bookId] = row;
      }

      // Batch-fetch all edition selections for these books
      const editionRows = await db
        .select({
          bookId: userOwnedEditions.bookId,
          format: userOwnedEditions.format,
          coverId: editions.coverId,
        })
        .from(userOwnedEditions)
        .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
        .where(
          and(
            eq(userOwnedEditions.userId, user.userId),
            inArray(userOwnedEditions.bookId, bookIds)
          )
        )
        .all();

      // Group editions by bookId
      const editionsByBook: Record<string, { format: string; coverId: number | null }[]> = {};
      for (const ed of editionRows) {
        if (!editionsByBook[ed.bookId]) editionsByBook[ed.bookId] = [];
        editionsByBook[ed.bookId].push({ format: ed.format, coverId: ed.coverId });
      }

      // Compute effective cover for each book
      for (const bookId of bookIds) {
        const olKey = bookIdToKey[bookId];
        if (!olKey) continue;

        const stateRow = stateByBookId[bookId];
        const isActivelyReading = stateRow?.state === "currently_reading" || stateRow?.state === "paused";
        const activeFormats = stateRow?.activeFormats ? JSON.parse(stateRow.activeFormats) as string[] : [];
        const owned = stateRow?.ownedFormats ? JSON.parse(stateRow.ownedFormats) as string[] : [];

        const effectiveCover = getEffectiveCoverUrl({
          baseCoverUrl: bookIdToCover[bookId],
          editionSelections: editionsByBook[bookId] ?? [],
          activeFormats,
          ownedFormats: owned,
          isActivelyReading,
          size: "M",
        });

        if (effectiveCover) {
          covers[olKey] = effectiveCover;
        }
      }
    }
  } else {
    // No user logged in — still return base covers for imported books
    for (const [olKey, bookId] of Object.entries(existing)) {
      const baseCover = bookIdToCover[bookId];
      if (baseCover) covers[olKey] = baseCover;
    }
  }

  return NextResponse.json({ existing, states, ownedFormats, covers });
}
