import { db } from "@/db";
import {
  books,
  bookAuthors,
  authors,
  userBookState,
  bookSeries,
  bookGenres,
  genres,
  readingSessions,
  userOwnedEditions,
  editions,
} from "@/db/schema";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import { isEnglishTitle, looksLikeMidSeriesTitle } from "@/lib/queries/books";
import { getEffectiveCoverUrl } from "@/lib/covers";

export interface TbrSuggestion {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  reason: string | null;
}

/**
 * Get a random owned + unread TBR book for the user, with a contextual reason.
 */
export async function getRandomOwnedTbrBook(userId: string): Promise<TbrSuggestion | null> {
  // Fetch a pool of candidates and filter client-side for English titles / no box sets
  const candidates = await db
    .select({
      id: books.id,
      slug: books.slug,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      pages: books.pages,
      isBoxSet: books.isBoxSet,
      ownedFormats: userBookState.ownedFormats,
    })
    .from(userBookState)
    .innerJoin(books, eq(userBookState.bookId, books.id))
    .where(
      and(
        eq(userBookState.userId, userId),
        eq(userBookState.state, "tbr"),
        isNotNull(books.coverImageUrl),
      )
    )
    .orderBy(sql`RANDOM()`)
    .limit(20)
    .all();

  // Filter: English, no box sets, no mid-series title heuristic
  const basicFiltered = candidates.filter(
    (c) => isEnglishTitle(c.title) && !c.isBoxSet && !looksLikeMidSeriesTitle(c.title)
  );
  if (basicFiltered.length === 0) return null;

  // Series-aware filtering: only suggest books that are next-unread or book #1
  const candidateIds = basicFiltered.map((c) => c.id);
  const seriesRows = await db
    .select({
      bookId: bookSeries.bookId,
      seriesId: bookSeries.seriesId,
      position: bookSeries.positionInSeries,
    })
    .from(bookSeries)
    .where(sql`${bookSeries.bookId} IN (${sql.join(candidateIds.map((id) => sql`${id}`), sql`, `)})`)
    .all();

  // Build book → series info
  const seriesByBook = new Map<string, { seriesId: string; position: number | null }[]>();
  const relevantSeriesIds = new Set<string>();
  for (const r of seriesRows) {
    const entries = seriesByBook.get(r.bookId) ?? [];
    entries.push({ seriesId: r.seriesId, position: r.position });
    seriesByBook.set(r.bookId, entries);
    relevantSeriesIds.add(r.seriesId);
  }

  // Get user's highest completed position per relevant series
  const highestRead = new Map<string, number>();
  const startedSeries = new Set<string>();
  if (relevantSeriesIds.size > 0) {
    const progressRows = await db
      .select({
        seriesId: bookSeries.seriesId,
        position: bookSeries.positionInSeries,
      })
      .from(userBookState)
      .innerJoin(bookSeries, eq(userBookState.bookId, bookSeries.bookId))
      .where(
        and(
          eq(userBookState.userId, userId),
          sql`${userBookState.state} IN ('completed', 'currently_reading')`,
          sql`${bookSeries.seriesId} IN (${sql.join([...relevantSeriesIds].map((id) => sql`${id}`), sql`, `)})`
        )
      )
      .all();

    for (const r of progressRows) {
      startedSeries.add(r.seriesId);
      if (r.position != null) {
        const current = highestRead.get(r.seriesId) ?? 0;
        if (r.position > current) highestRead.set(r.seriesId, r.position);
      }
    }
  }

  // Filter: for series books, only allow next-unread or book #1
  const row = basicFiltered.find((c) => {
    const entries = seriesByBook.get(c.id);
    if (!entries || entries.length === 0) return true; // standalone → allow

    for (const { seriesId, position } of entries) {
      if (position == null) return false; // unknown position in series → skip
      if (startedSeries.has(seriesId)) {
        const highest = highestRead.get(seriesId) ?? 0;
        if (position > highest && position <= highest + 1) return true;
      } else {
        if (position <= 1) return true; // book #1 of unstarted series
      }
    }
    return false;
  });
  if (!row) return null;

  // Build contextual reason
  const isOwned = row.ownedFormats != null && row.ownedFormats !== "[]" && row.ownedFormats !== "";

  // Parallel fetch: authors, reason, and edition covers
  const [authorRows, reason, editionRows] = await Promise.all([
    db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, row.id)),
    buildTbrReason(userId, row.id, row.pages, isOwned),
    db
      .select({ coverId: editions.coverId, format: userOwnedEditions.format })
      .from(userOwnedEditions)
      .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
      .where(and(eq(userOwnedEditions.userId, userId), eq(userOwnedEditions.bookId, row.id)))
      .all(),
  ]);

  const ownedFormats = row.ownedFormats ? JSON.parse(row.ownedFormats) as string[] : [];

  const effectiveCover = getEffectiveCoverUrl({
    baseCoverUrl: row.coverImageUrl,
    editionSelections: editionRows,
    activeFormats: [],
    ownedFormats,
    isActivelyReading: false,
    size: "M",
  });

  return {
    id: row.id,
    slug: row.slug ?? null,
    title: row.title,
    coverImageUrl: effectiveCover,
    authors: authorRows.map((a) => a.name),
    reason,
  };
}

/**
 * Generate a short contextual reason for why this TBR book might be a good pick.
 * Compares the suggested book to the user's last completed book.
 */
async function buildTbrReason(
  userId: string,
  bookId: string,
  pages: number | null,
  isOwned: boolean
): Promise<string | null> {
  // Parallel fetch: suggested book's genres AND user's last completed book
  const [tbrGenreRows, lastCompleted] = await Promise.all([
    db
      .select({ genreName: genres.name })
      .from(bookGenres)
      .innerJoin(genres, eq(bookGenres.genreId, genres.id))
      .where(eq(bookGenres.bookId, bookId))
      .all(),
    db
      .select({
        bookId: readingSessions.bookId,
        bookTitle: books.title,
        bookPages: books.pages,
      })
      .from(readingSessions)
      .innerJoin(books, eq(readingSessions.bookId, books.id))
      .where(
        and(
          eq(readingSessions.userId, userId),
          eq(readingSessions.state, "completed")
        )
      )
      .orderBy(sql`${readingSessions.completionDate} DESC`)
      .limit(1)
      .get(),
  ]);

  const tbrGenres = new Set(tbrGenreRows.map((r) => r.genreName));

  if (!lastCompleted) {
    return genreBasedReason(tbrGenres) ?? (isOwned ? "From your owned shelf" : null);
  }

  // Fetch last completed book's genres
  const lastGenreRows = await db
    .select({ genreName: genres.name })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(eq(bookGenres.bookId, lastCompleted.bookId))
    .all();

  const lastGenres = new Set(lastGenreRows.map((r) => r.genreName));

  // Find shared genres
  const shared = [...tbrGenres].filter((g) => lastGenres.has(g));

  // Check if it's a "palate cleanser" — very different genres and shorter
  const isShort = pages != null && pages < 250;
  const lastWasLong = lastCompleted.bookPages != null && lastCompleted.bookPages > 400;
  const lowOverlap = shared.length === 0 || (shared.length === 1 && tbrGenres.size > 3);

  if (lowOverlap && isShort) {
    return "A quick palate cleanser";
  }

  if (lowOverlap && lastWasLong && pages != null && pages < lastCompleted.bookPages! * 0.6) {
    return "Something different & lighter";
  }

  // Shared genre — reference it
  if (shared.length > 0) {
    // Pick the most specific shared genre (prefer sub-genres over broad ones)
    const broadGenres = new Set(["Fiction", "Nonfiction", "Literature", "Novels"]);
    const specific = shared.filter((g) => !broadGenres.has(g));
    const genreLabel = specific.length > 0 ? specific[0] : shared[0];

    // Format: "More science fiction" or "Another thriller"
    const vowels = "aeiouAEIOU";
    const article = vowels.includes(genreLabel[0]) ? "Another" : "More";
    return `${article} ${genreLabel.toLowerCase()}`;
  }

  // Fallback: genre-based reason from the TBR book alone
  const genreReason = genreBasedReason(tbrGenres);
  if (genreReason) return genreReason;

  // Final fallback: owned shelf
  return isOwned ? "From your owned shelf" : null;
}

function genreBasedReason(genreNames: Set<string>): string | null {
  const broadGenres = new Set(["Fiction", "Nonfiction", "Literature", "Novels"]);
  const specific = [...genreNames].filter((g) => !broadGenres.has(g));
  if (specific.length === 0) return null;

  // Pick first specific genre
  const genre = specific[0].toLowerCase();
  const article = /^[aeiou]/i.test(genre) ? "An" : "A";
  return `${article} ${genre} pick`;
}
