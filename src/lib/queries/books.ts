import { unstable_cache } from "next/cache";
import { db } from "@/db";
import {
  books,
  authors,
  bookAuthors,
  genres,
  bookGenres,
  bookCategoryRatings,
  taxonomyCategories,
  links,
  series,
  bookSeries,
  userBookRatings,
  userOwnedEditions,
  editions,
  userBookState,
} from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { getEffectiveCoverUrl } from "@/lib/covers";
import { classifyGenres } from "@/lib/genre-taxonomy";

/** UUID v4 pattern for distinguishing IDs from slugs */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Look up a book by either UUID or slug. Returns the book row or null.
 * Also returns `isIdLookup` so callers can decide whether to redirect.
 */
export async function resolveBook(idOrSlug: string) {
  if (UUID_PATTERN.test(idOrSlug)) {
    const book = await db.query.books.findFirst({ where: eq(books.id, idOrSlug) });
    return book ? { book, isIdLookup: true } : null;
  }
  // Slug lookup
  const book = await db.query.books.findFirst({ where: eq(books.slug, idOrSlug) });
  return book ? { book, isIdLookup: false } : null;
}

/**
 * Look up a series by either UUID or slug.
 */
export async function resolveSeries(idOrSlug: string) {
  if (UUID_PATTERN.test(idOrSlug)) {
    const row = await db.select({ id: series.id, slug: series.slug, parentSeriesId: series.parentSeriesId }).from(series).where(eq(series.id, idOrSlug)).get();
    return row ? { series: row, isIdLookup: true } : null;
  }
  const row = await db.select({ id: series.id, slug: series.slug, name: series.name, parentSeriesId: series.parentSeriesId }).from(series).where(eq(series.slug, idOrSlug)).get();
  return row ? { series: row, isIdLookup: false } : null;
}

/**
 * Get all child series for a franchise/parent series.
 * Returns empty array for non-franchise series (indexed lookup, negligible cost).
 */
export async function getChildSeries(parentId: string) {
  const children = await db
    .select({
      id: series.id,
      name: series.name,
      slug: series.slug,
      bookCount: sql<number>`COUNT(${bookSeries.bookId})`,
    })
    .from(series)
    .leftJoin(bookSeries, eq(bookSeries.seriesId, series.id))
    .where(eq(series.parentSeriesId, parentId))
    .groupBy(series.id)
    .orderBy(series.name);

  // Get a cover for each child (first book by position that has a cover)
  const enriched = await Promise.all(
    children.map(async (child) => {
      const coverRow = await db
        .select({ coverImageUrl: books.coverImageUrl })
        .from(bookSeries)
        .innerJoin(books, eq(books.id, bookSeries.bookId))
        .where(
          and(
            eq(bookSeries.seriesId, child.id),
            sql`${books.coverImageUrl} IS NOT NULL`
          )
        )
        .orderBy(bookSeries.positionInSeries)
        .limit(1)
        .get();

      return {
        ...child,
        coverImageUrl: coverRow?.coverImageUrl ?? null,
      };
    })
  );

  return enriched;
}

/**
 * Get the parent franchise for a series, if it has one.
 */
export async function getParentSeries(seriesId: string) {
  const row = await db
    .select({ parentSeriesId: series.parentSeriesId })
    .from(series)
    .where(eq(series.id, seriesId))
    .get();

  if (!row?.parentSeriesId) return null;

  const parent = await db
    .select({ id: series.id, name: series.name, slug: series.slug })
    .from(series)
    .where(eq(series.id, row.parentSeriesId))
    .get();

  return parent ?? null;
}

async function getBookWithDetailsInner(bookId: string, userId?: string | null) {
  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });
  if (!book) return null;

  // Get authors
  const bookAuthorRows = await db
    .select({ id: authors.id, name: authors.name, slug: authors.slug, role: bookAuthors.role })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(eq(bookAuthors.bookId, bookId));

  // Get genres (filter out parent genres when their children are also linked)
  const bookGenreRows = await db
    .select({
      genreId: genres.id,
      name: genres.name,
      parentGenreId: genres.parentGenreId,
    })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(eq(bookGenres.bookId, bookId));

  // Classify genres using the curated taxonomy
  const { primaryGenre: topLevelGenre, ageCategory, displayGenres: classifiedGenres } = classifyGenres(bookGenreRows);

  const displayGenres = classifiedGenres;

  // Get category ratings with category info
  const ratings = await db
    .select({
      categoryId: taxonomyCategories.id,
      categoryKey: taxonomyCategories.key,
      categoryName: taxonomyCategories.name,
      intensity: bookCategoryRatings.intensity,
      notes: bookCategoryRatings.notes,
      evidenceLevel: bookCategoryRatings.evidenceLevel,
    })
    .from(bookCategoryRatings)
    .innerJoin(
      taxonomyCategories,
      eq(bookCategoryRatings.categoryId, taxonomyCategories.id)
    )
    .where(eq(bookCategoryRatings.bookId, bookId));

  // Get links
  const bookLinks = await db
    .select()
    .from(links)
    .where(eq(links.bookId, bookId));

  // Get series info
  const seriesRow = await db
    .select({
      seriesId: series.id,
      seriesName: series.name,
      seriesSlug: series.slug,
      seriesCoverStyle: series.coverStyle,
      position: bookSeries.positionInSeries,
    })
    .from(bookSeries)
    .innerJoin(series, eq(bookSeries.seriesId, series.id))
    .where(eq(bookSeries.bookId, bookId))
    .limit(1);

  let seriesInfo: {
    id: string;
    name: string;
    slug: string | null;
    books: { id: string; title: string; coverImageUrl: string | null; position: number | null; userRating: number | null }[];
  } | null = null;

  if (seriesRow.length > 0) {
    const { seriesId, seriesName, seriesSlug, seriesCoverStyle } = seriesRow[0];
    const useFormatCovers = seriesCoverStyle === "format";

    const seriesBooksRaw = await db
      .select({
        id: books.id,
        title: books.title,
        coverImageUrl: books.coverImageUrl,
        seriesCoverUrl: books.seriesCoverUrl,
        isBoxSet: books.isBoxSet,
        position: bookSeries.positionInSeries,
      })
      .from(bookSeries)
      .innerJoin(books, eq(bookSeries.bookId, books.id))
      .where(eq(bookSeries.seriesId, seriesId))
      .orderBy(asc(bookSeries.positionInSeries));

    // Enrich with user ratings and (optionally) effective covers
    const seriesBooks = [];
    for (const sb of seriesBooksRaw) {
      let userRating: number | null = null;
      // Use admin series cover override if set, otherwise base cover
      let effectiveCover = sb.seriesCoverUrl ?? sb.coverImageUrl;

      if (userId) {
        // Get user rating
        const rating = await db
          .select({ rating: userBookRatings.rating })
          .from(userBookRatings)
          .where(and(eq(userBookRatings.userId, userId), eq(userBookRatings.bookId, sb.id)))
          .get();
        userRating = rating?.rating ?? null;

        // Only apply edition cover cascade if series is set to 'format' mode
        if (useFormatCovers) {
          const editionRows = await db
            .select({ coverId: editions.coverId, format: userOwnedEditions.format })
            .from(userOwnedEditions)
            .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
            .where(and(eq(userOwnedEditions.userId, userId), eq(userOwnedEditions.bookId, sb.id)))
            .all();

          const stateRow = await db
            .select({ state: userBookState.state, ownedFormats: userBookState.ownedFormats, activeFormats: userBookState.activeFormats })
            .from(userBookState)
            .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, sb.id)))
            .get();

          const isActivelyReading = stateRow?.state === "currently_reading" || stateRow?.state === "paused";
          const activeFormats = stateRow?.activeFormats ? JSON.parse(stateRow.activeFormats) as string[] : [];
          const ownedFmts = stateRow?.ownedFormats ? JSON.parse(stateRow.ownedFormats) as string[] : [];

          effectiveCover = getEffectiveCoverUrl({
            baseCoverUrl: sb.coverImageUrl,
            editionSelections: editionRows,
            activeFormats,
            ownedFormats: ownedFmts,
            isActivelyReading,
            size: "M",
          });
        }
      }

      seriesBooks.push({
        id: sb.id,
        title: sb.title,
        coverImageUrl: effectiveCover,
        position: sb.position,
        userRating,
        isBoxSet: sb.isBoxSet ?? false,
      });
    }

    // Deduplicate: keep one book per position (prefer the one with a cover)
    // Also filter out entries with no position that look like box sets
    const deduped = deduplicateSeriesBooks(seriesBooks);

    seriesInfo = {
      id: seriesId,
      name: seriesName,
      slug: seriesSlug,
      books: deduped,
    };
  }

  // Get series position for the current book
  const currentBookSeriesPosition = seriesRow.length > 0 ? seriesRow[0].position : null;

  // Check if this series belongs to a franchise
  let parentFranchise: { id: string; name: string; slug: string | null } | null = null;
  if (seriesRow.length > 0) {
    parentFranchise = await getParentSeries(seriesRow[0].seriesId);
  }

  return {
    ...book,
    authors: bookAuthorRows,
    genres: displayGenres,
    topLevelGenre,
    ageCategory,
    ratings,
    links: bookLinks,
    seriesInfo,
    seriesPosition: currentBookSeriesPosition,
    parentFranchise,
  };
}

/**
 * Cached wrapper for getBookWithDetailsInner.
 * For anonymous users (no userId), results are cached for 60 seconds.
 * For authenticated users, skip cache to preserve personalized data.
 */
const getCachedBookDetails = unstable_cache(
  async (bookId: string) => getBookWithDetailsInner(bookId, null),
  ["book-details"],
  { revalidate: 60 }
);

export async function getBookWithDetails(bookId: string, userId?: string | null) {
  if (userId) {
    // Authenticated: skip cache, return personalized results
    return getBookWithDetailsInner(bookId, userId);
  }
  // Anonymous: use cached version
  return getCachedBookDetails(bookId);
}

export async function getSeriesBooks(seriesId: string, userId: string | null) {
  const seriesRow = await db
    .select({ name: series.name, coverStyle: series.coverStyle })
    .from(series)
    .where(eq(series.id, seriesId))
    .get();

  if (!seriesRow) return null;
  const useFormatCovers = seriesRow.coverStyle === "format";

  const seriesBooksRaw = await db
    .select({
      id: books.id,
      slug: books.slug,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      seriesCoverUrl: books.seriesCoverUrl,
      openLibraryKey: books.openLibraryKey,
      position: bookSeries.positionInSeries,
      publicationYear: books.publicationYear,
      isBoxSet: books.isBoxSet,
    })
    .from(bookSeries)
    .innerJoin(books, eq(bookSeries.bookId, books.id))
    .where(eq(bookSeries.seriesId, seriesId))
    .orderBy(asc(bookSeries.positionInSeries));

  const enrichedBooks = [];
  for (const sb of seriesBooksRaw) {
    // Get authors
    const bookAuthorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, sb.id))
      .all();

    let userRating: number | null = null;
    let currentState: string | null = null;
    let ownedFormats: string[] = [];
    // Use admin series cover override if set, otherwise base cover
    let effectiveCover = sb.seriesCoverUrl ?? sb.coverImageUrl;

    if (userId) {
      const rating = await db
        .select({ rating: userBookRatings.rating })
        .from(userBookRatings)
        .where(and(eq(userBookRatings.userId, userId), eq(userBookRatings.bookId, sb.id)))
        .get();
      userRating = rating?.rating ?? null;

      const stateRow = await db
        .select({ state: userBookState.state, ownedFormats: userBookState.ownedFormats })
        .from(userBookState)
        .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, sb.id)))
        .get();
      currentState = stateRow?.state ?? null;
      ownedFormats = stateRow?.ownedFormats ? JSON.parse(stateRow.ownedFormats) as string[] : [];

      // Only apply edition cover cascade if series is set to 'format' mode
      if (useFormatCovers) {
        const editionRows = await db
          .select({ coverId: editions.coverId, format: userOwnedEditions.format })
          .from(userOwnedEditions)
          .innerJoin(editions, eq(userOwnedEditions.editionId, editions.id))
          .where(and(eq(userOwnedEditions.userId, userId), eq(userOwnedEditions.bookId, sb.id)))
          .all();

        const isActivelyReading = currentState === "currently_reading" || currentState === "paused";
        const activeFormatsStr = stateRow?.state ? (await db
          .select({ activeFormats: userBookState.activeFormats })
          .from(userBookState)
          .where(and(eq(userBookState.userId, userId), eq(userBookState.bookId, sb.id)))
          .get())?.activeFormats : null;
        const activeFormats = activeFormatsStr ? JSON.parse(activeFormatsStr) as string[] : [];

        effectiveCover = getEffectiveCoverUrl({
          baseCoverUrl: sb.coverImageUrl,
          editionSelections: editionRows,
          activeFormats,
          ownedFormats,
          isActivelyReading,
          size: "M",
        });
      }
    }

    enrichedBooks.push({
      id: sb.id,
      title: sb.title,
      coverImageUrl: effectiveCover,
      openLibraryKey: sb.openLibraryKey,
      position: sb.position,
      publicationYear: sb.publicationYear,
      authors: bookAuthorRows.map((a) => a.name),
      userRating,
      currentState,
      ownedFormats,
      isBoxSet: sb.isBoxSet ?? false,
    });
  }

  // Deduplicate: keep one book per position (but keep all for filtering)
  const deduped = deduplicateSeriesBooks(enrichedBooks);

  // Re-add box sets so the "Sets" tab has content
  const boxSets = enrichedBooks.filter((b) => b.isBoxSet);
  const dedupedIds = new Set(deduped.map((b) => b.id));
  for (const bs of boxSets) {
    if (!dedupedIds.has(bs.id)) {
      deduped.push(bs);
    }
  }

  return {
    name: seriesRow.name,
    coverStyle: seriesRow.coverStyle,
    books: deduped,
  };
}

/**
 * Get series books by slug. Resolves slug → ID, then delegates to getSeriesBooks.
 */
export async function getSeriesBooksBySlug(slug: string, userId: string | null) {
  const seriesRow = await db
    .select({ id: series.id, slug: series.slug })
    .from(series)
    .where(eq(series.slug, slug))
    .get();
  if (!seriesRow) return null;
  const data = await getSeriesBooks(seriesRow.id, userId);
  if (!data) return null;
  return { ...data, id: seriesRow.id, slug: seriesRow.slug };
}

/**
 * Box-set title patterns to filter out at display time.
 */
export const BOX_SET_PATTERNS = [
  /\bbox\s*set\b/i,
  /\bboxed\s*set\b/i,
  /\bcollection\s+(set|of)\b/i,
  /\bseries\s+collection\b/i,
  /\bcomplete\s+collection\b/i,
  /\bsaga\s+collection\b/i,
  /\b(books?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(volumes?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(omnibus|anthology|compendium|complete\s+series)\b/i,
  /\b\d+\s*-?\s*book\s+(set|bundle|pack|series|collection)\b/i,
  /\bLib\/E\b/i,
  /\bUnabridged\b.*\b(CD|Audio)\b/i,
  /\bBooks?\s+Collection\s+Set\b/i,
  /\bHardcover\s+Series\b/i,
  /\bImport\s+collector'?s?\s+ed/i,
  /\bCollection\s+Set\b/i,
  // Non-book editions
  /\bcoloring\s*book\b/i,
  /\bcolouring\s*book\b/i,
  /\bactivity\s*book\b/i,
  /\bgiant\s*poster\b/i,
  /\blow\s*price\s*cd\b/i,
  /\b(audio\s*)?cd\s*$/i,
  /\b\d+\s*-?\s*pack\b/i,
  /\bpop-?up\s*book\b/i,
  /\bsticker\s*book\b/i,
  /\bselections?\s+from\b/i,
  // Omnibus bindings: "Novels (X / Y)", "Tpb Bind up", "Bind-up"
  /\bbind[\s-]*up\b/i,
  /^novels?\s*\(/i,
  // "Volume X" without series context (standalone graphic novel/comic volumes)
  /\bvolume\s+\d+\s*$/i,
  // Illustrated/special editions that aren't the main book
  /\billustrated\s+edition\b/i,
  // Spanish/foreign comic issue numbers: "nº 03/09", "Tomo nº 02/03"
  /\bnº\s*\d+/i,
  /\btomo\s+/i,
  // "Trilogy" / "Duology" with parenthetical listing: "The X Trilogy (A / B / C)"
  /\b(trilogy|duology)\b.*\(/i,
  // "#1-3" or "#1-5" range notation
  /#\d+\s*[-–—]\s*\d+/,
  // Slash-separated multi-title: "Book A / Book B / Book C" (3+ titles)
  /\/.+\//,
];

export function isBoxSetTitle(title: string): boolean {
  return BOX_SET_PATTERNS.some((p) => p.test(title));
}

/**
 * Heuristic: does a title look like it's a mid-series book (position > 1)?
 * Catches books that lack a `book_series` entry but have obvious series
 * numbering in their title. Used as a safety net in recommendation filtering.
 *
 * Only triggers for numbers > 1 — "Book 1" or "#1" are fine as entry points.
 */
const MID_SERIES_TITLE_PATTERNS = [
  // "Book 2", "Book 3", etc. (not "Book 1")
  /\bbook\s+([2-9]|\d{2,})\b/i,
  // "#2", "#3", "# 2" etc.
  /\b#\s*([2-9]|\d{2,})\b/,
  // "Volume 2", "Vol. 3", "Vol 2" (not volume 1)
  /\bvol(?:ume)?\.?\s+([2-9]|\d{2,})\b/i,
  // "(Series Name, 2)", "(Series Name, #3)", "(Series Name Book 2)"
  /\(\s*[^)]+[,#]\s*([2-9]|\d{2,})\s*\)/i,
  // "Part 2", "Part Three" etc.
  /\bpart\s+(two|three|four|five|six|seven|eight|nine|ten|[2-9]|\d{2,})\b/i,
  // Explicit sequel/series markers
  /\b(trilogy|duology)\b.*\b(book|#)\s*([2-9]|\d{2,})\b/i,
];

export function looksLikeMidSeriesTitle(title: string): boolean {
  return MID_SERIES_TITLE_PATTERNS.some((p) => p.test(title));
}

/**
 * Deduplicate series books:
 * 1. Filter out box sets / collections by title
 * 2. For books with a position, keep one per position (prefer one with a cover)
 * 3. Keep all books with null position (but only if not a box set)
 */
/**
 * Check if a title appears to be English.
 * Catches:
 * - Non-ASCII scripts (Cyrillic, CJK, Arabic, etc.)
 * - Common non-English Latin-alphabet markers (accented words, foreign articles/prepositions)
 */
const NON_ENGLISH_PATTERNS = [
  // Polish/Czech/Slavic diacritics — virtually never in English titles
  /[łśźżćąęŁŚŹŻĆĄĘ]/,
  // Nordic-specific characters — very rare in English titles
  /[åæøÅÆØ]/,
  // German-specific characters
  /[äöüÄÖÜß]/,
  // German words/markers
  /\b(das|der|die|und|oder|für|über|ein|eine|vom|zur|zum|Tödliche|Lektion|Geschichte|Buch|erwacht|Geheimnis)\b/i,
  // French articles/prepositions/words
  /\b(avec|dans|pour|une|fille|froide|lune|autres|mortels|pasteur|monde|héritage|incroyable|affreuse|meurtrière|charmante?|garce|allumeuse|pétard|nouvelle|nouvelle|trop|chance|maison|coeur|amour|nuit|jour|mort|petit|petite|grand|grande|noir|blanc|rouge|bleu|vert|vrai|faux|nouveau|beau|belle|jeune|vieux|haut|bas|seul|tout|même|autre|cher|chère)\b/i,
  /\b(le|la|les|du|des|au|aux|ce|cette|qui|est|sont|sur|par|en)\b(?=\s+[a-zà-ÿ])/i,
  // Spanish/Portuguese
  /\b(del|los|las|por|como|desde|hacia|seus|sua|seu|mejor|amiga|amigo|sangre|fuego|ceniza|linaje|gracia|junto|monstruo|viene|verme|secreto|cuentos|comienzo|luchador|cumpleaños|pequeño|favor|aquí|casa|sal|lágrimas|cartas|diablo|caza|poder|reglas|estuche)\b/i,
  // Italian
  /\b(nel|nella|della|degli|delle|dell|giardino|oscurità|sogni)\b/i,
  // Dutch
  /\b(het|een|van|zij|haar|hij|zijn|priester|ontsnapping|echtgenoten|mandolinespeler|verzamelde|werken|bijbel|nachtegaal|boomgaard|ellendigen|mevrouw)\b/i,
  // Titles starting with non-English articles (followed by a word)
  /^(El|Lo|Gli|Een|Het|Las|Los|Une)\s+\w/i,
  // "Un " at start followed by clearly non-English word (not "Un-" prefix)
  /^Un\s+[a-záéíóúñ]/i,
  // Edition markers in other languages
  /\bédition\b|\bTeil\b|\bBand\b|\bTome\b|\bTomo\b|\bLivre\b|\blivro\b|\bSérie\b/i,
  // Common non-English suffixes (words ending in -zione, -ción, -ção, -heit, -keit, -ung)
  /\b\w+(zione|ción|ção|heit|keit|ung|eux|euse|eux|isse)\b/i,
  // Titles starting with "Estuche" (Spanish box set) or "Coffret" (French box set)
  /^(Estuche|Coffret)\s/i,
  // Words with accented characters (any word containing ö, ü, ä, è, ê, ë, ñ, etc.)
  // Two+ accented words is almost certainly non-English
  /\b\w*[à-ëí-ïñ-öù-ü]\w*\b.*\b\w*[à-ëí-ïñ-öù-ü]\w*\b/,
  // Single accented word that's clearly not an English loanword (handles mixed/uppercase)
  /\b\w*[ñÑ]\w*\b/,  // ñ is almost never in English words
  /\b[A-ZÀ-ß][a-zà-ÿ]*[à-ëí-ïò-öù-ü][a-zà-ÿ]+\b/i,
];

// English words/names that contain diacritics — must not trigger false positives
const ENGLISH_WHITELIST = /\b(Brontë|Horrorstör|Brené|café|Café|naïve|résumé|Doré|André|fiancé|fiancée|cliché|décor|début|Beyoncé|Pokémon)\b/i;

export function isEnglishTitle(title: string): boolean {
  // First: check for non-ASCII scripts (Cyrillic, CJK, Arabic, Hebrew, etc.)
  const asciiChars = title.replace(/[^a-zA-Z]/g, "").length;
  const totalChars = title.replace(/[^a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF\u0590-\u05FF\uAC00-\uD7AF\u3040-\u30FF]/g, "").length;
  if (totalChars > 0 && asciiChars / totalChars <= 0.8) return false;

  // Strip whitelisted English words before checking non-English patterns
  const stripped = title.replace(ENGLISH_WHITELIST, "");

  // Second: check for common non-English Latin-alphabet patterns
  for (const pattern of NON_ENGLISH_PATTERNS) {
    if (pattern.test(stripped)) return false;
  }

  return true;
}

function deduplicateSeriesBooks<T extends { title: string; position: number | null; coverImageUrl: string | null; isBoxSet: boolean }>(
  seriesBooks: T[]
): T[] {
  // Group by position (keep box sets separate — they'll be tagged isBoxSet in the result)
  const nonBoxSets = seriesBooks.filter((b) => !b.isBoxSet);
  const byPosition = new Map<number, T[]>();
  const noPosition: T[] = [];

  for (const book of nonBoxSets) {
    if (book.position != null) {
      const group = byPosition.get(book.position) ?? [];
      group.push(book);
      byPosition.set(book.position, group);
    } else {
      noPosition.push(book);
    }
  }

  // For each position, pick the best entry: prefer English title with a cover
  const result: T[] = [];
  for (const [, group] of [...byPosition.entries()].sort((a, b) => a[0] - b[0])) {
    const best =
      group.find((b) => b.coverImageUrl != null && isEnglishTitle(b.title)) ??
      group.find((b) => isEnglishTitle(b.title)) ??
      group.find((b) => b.coverImageUrl != null) ??
      group[0];
    result.push(best);
  }

  // Append books with no position (may still be valid novellas / short stories)
  // But deduplicate by normalized title against positioned books
  const positionedTitles = new Set(result.map((b) => b.title.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const book of noPosition) {
    const norm = book.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!positionedTitles.has(norm)) {
      result.push(book);
      positionedTitles.add(norm);
    }
  }

  return result;
}
