import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { books, bookAuthors, authors, userBookState } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { isJunkTitle } from "@/lib/openlibrary";
import { isBoxSetTitle } from "@/lib/queries/books";
import { searchBooksFTS } from "@/lib/search/search-index";

/**
 * GET /api/v1/search?q=
 * Local-first FTS5 search — the same engine + junk/box-set filtering as
 * /api/openlibrary/search, returning clean book rows for the native app.
 * (ISBNdb external supplement for <5 results is a tracked follow-up —
 * it requires the import-from-external flow.)
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q || q.trim().length < 2) return jsonOk({ results: [] });

  const trimmed = q.trim()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"');

  const BOX_SET_QUERY = /\b(set|box\s*set|collection|boxed)\b/i;
  const showBoxSets = BOX_SET_QUERY.test(trimmed);

  const ftsResults = await searchBooksFTS(trimmed, 30);
  if (ftsResults.length === 0) return jsonOk({ results: [] });

  const bookIds = ftsResults.map((r) => r.bookId);

  const [bookRows, authorRows, stateRows] = await Promise.all([
    db
      .select({
        id: books.id,
        title: books.title,
        slug: books.slug,
        coverImageUrl: books.coverImageUrl,
        publicationYear: books.publicationYear,
        pages: books.pages,
      })
      .from(books)
      .where(sql`${books.id} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
      .all(),
    db
      .select({ bookId: bookAuthors.bookId, name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(sql`${bookAuthors.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
      .all(),
    // The user's existing relationship with each result (state pill + Owned pill)
    db
      .select({
        bookId: userBookState.bookId,
        state: userBookState.state,
        ownedFormats: userBookState.ownedFormats,
      })
      .from(userBookState)
      .where(and(
        eq(userBookState.userId, user.userId),
        sql`${userBookState.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`
      ))
      .all(),
  ]);

  const stateMap = new Map(stateRows.map((r) => [r.bookId, r]));

  const bookMap = new Map(bookRows.map((b) => [b.id, b]));
  const authorsByBook = new Map<string, string[]>();
  for (const row of authorRows) {
    const list = authorsByBook.get(row.bookId) ?? [];
    list.push(row.name);
    authorsByBook.set(row.bookId, list);
  }

  const results = [];
  for (const ftsRow of ftsResults) {
    const row = bookMap.get(ftsRow.bookId);
    if (!row) continue;
    if (isJunkTitle(row.title) || (!showBoxSets && isBoxSetTitle(row.title))) continue;
    const userRow = stateMap.get(row.id);
    let ownedCount = 0;
    if (userRow?.ownedFormats) {
      try {
        ownedCount = (JSON.parse(userRow.ownedFormats) as string[]).filter((f) => f !== "unknown").length;
      } catch { /* malformed json — treat as none */ }
    }
    results.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      coverImageUrl: row.coverImageUrl,
      authors: authorsByBook.get(row.id) ?? [],
      publicationYear: row.publicationYear,
      pages: row.pages,
      state: userRow?.state ?? null,
      ownedCount,
    });
    if (results.length >= 20) break;
  }

  return jsonOk({ results });
}
