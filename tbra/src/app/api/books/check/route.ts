import { NextResponse } from "next/server";
import { db } from "@/db";
import { books, userBookState } from "@/db/schema";
import { inArray, eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
  const { keys } = (await request.json()) as { keys: string[] };

  if (!keys?.length) {
    return NextResponse.json({ existing: {}, states: {}, ownedFormats: {} });
  }

  const rows = await db
    .select({
      id: books.id,
      openLibraryKey: books.openLibraryKey,
    })
    .from(books)
    .where(inArray(books.openLibraryKey, keys))
    .all();

  const existing: Record<string, string> = {};
  for (const row of rows) {
    if (row.openLibraryKey) {
      existing[row.openLibraryKey] = row.id;
    }
  }

  // Also return reading states and owned formats for the current user
  const states: Record<string, string> = {};
  const ownedFormats: Record<string, string[]> = {};
  const user = await getCurrentUser();

  if (user) {
    const bookIds = Object.values(existing);
    if (bookIds.length > 0) {
      const stateRows = await db
        .select({
          bookId: userBookState.bookId,
          state: userBookState.state,
          ownedFormats: userBookState.ownedFormats,
        })
        .from(userBookState)
        .where(
          and(
            eq(userBookState.userId, user.userId),
            inArray(userBookState.bookId, bookIds)
          )
        )
        .all();

      // Build reverse map: bookId -> olKey
      const bookIdToOlKey: Record<string, string> = {};
      for (const [olKey, bookId] of Object.entries(existing)) {
        bookIdToOlKey[bookId] = olKey;
      }

      for (const row of stateRows) {
        const olKey = bookIdToOlKey[row.bookId];
        if (olKey && row.state) {
          states[olKey] = row.state;
        }
        if (olKey && row.ownedFormats) {
          ownedFormats[olKey] = JSON.parse(row.ownedFormats) as string[];
        }
      }
    }
  }

  return NextResponse.json({ existing, states, ownedFormats });
}
