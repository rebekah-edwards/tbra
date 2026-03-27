import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { books, bookAuthors, authors } from "@/db/schema";
import { eq, sql, and, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { userBookState } from "@/db/schema";

interface LocalBookResult {
  id: string;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  publicationYear: number | null;
  state: string | null;
}

/**
 * Local-only book search for the search bar dropdown.
 * Fast — no external API calls, just local SQLite.
 * Returns books already in the tbr*a database.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const trimmed = q.trim().toLowerCase();

  // Search local books by title (case-insensitive)
  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      publicationYear: books.publicationYear,
    })
    .from(books)
    .where(
      and(
        sql`LOWER(${books.title}) LIKE ${`%${trimmed}%`}`,
        ne(books.visibility, "import_only")
      )
    )
    .limit(8)
    .all();

  // Get authors for each book
  const results: LocalBookResult[] = [];
  for (const row of rows) {
    const bookAuthorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, row.id))
      .all();

    results.push({
      id: row.id,
      title: row.title,
      coverImageUrl: row.coverImageUrl,
      authors: bookAuthorRows.map((a: { name: string }) => a.name),
      publicationYear: row.publicationYear,
      state: null,
    });
  }

  // Fetch reading states if user is logged in
  const user = await getCurrentUser();
  if (user && results.length > 0) {
    const bookIds = results.map((r) => r.id);
    const stateRows = await db
      .select({
        bookId: userBookState.bookId,
        state: userBookState.state,
      })
      .from(userBookState)
      .where(
        and(
          eq(userBookState.userId, user.userId),
          sql`${userBookState.bookId} IN (${sql.join(
            bookIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )
      )
      .all();

    const stateMap = new Map(stateRows.map((r: { bookId: string; state: string | null }) => [r.bookId, r.state]));
    for (const result of results) {
      result.state = stateMap.get(result.id) as string | null ?? null;
    }
  }

  return NextResponse.json(results);
}
