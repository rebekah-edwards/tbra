/**
 * Author bibliography discovery.
 * When a book is the first by a given author in the DB,
 * fetch and import their other works from Open Library.
 */
import { db } from "@/db";
import { books, bookAuthors, authors, bookGenres, genres as genresTable } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  searchOpenLibrary, fetchOpenLibraryWork, buildCoverUrl,
  normalizeGenres, findEnglishCover, isJunkTitle, fetchEarliestPublishYear,
} from "@/lib/openlibrary";
import { isEnglishTitle } from "@/lib/queries/books";
import { findDuplicateBook } from "./dedup";

const MAX_BOOKS_PER_AUTHOR = 30;
const DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Generic subject words that don't help distinguish one author from another.
const SUBJECT_STOPWORDS = new Set([
  "fiction", "nonfiction", "books", "general", "literature", "novel", "novels",
  "story", "stories", "english", "american", "british", "reading", "large", "print",
]);

// Reduce a list of OpenLibrary subjects to a set of significant tokens, used to
// test whether two works plausibly belong to the same real author. OL routinely
// merges several real people under one author record (e.g. a 1790s chemist and a
// modern children's novelist sharing a name), so a discovered "bibliography" can
// span wildly unrelated subjects. Comparing token overlap lets us drop the works
// that don't match the book that actually triggered discovery.
function subjectTokens(subjects: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of subjects) {
    for (const tok of s.toLowerCase().split(/[^a-z]+/)) {
      if (tok.length >= 4 && !SUBJECT_STOPWORDS.has(tok)) out.add(tok);
    }
  }
  return out;
}

/**
 * Discover and import other books by an author.
 * Only triggers if this is the first book by this author in the DB.
 */
export async function discoverAuthorBooks(
  authorId: string,
  authorName: string,
  authorOlKey?: string | null,
): Promise<void> {
  // Check if this is truly the first book by this author
  const bookCount = await db.all(sql`
    SELECT COUNT(*) as count FROM book_authors WHERE author_id = ${authorId}
  `) as { count: number }[];

  if ((bookCount[0]?.count ?? 0) > 1) {
    // Author already has multiple books, skip discovery
    return;
  }

  console.log(`[author-discovery] First book by "${authorName}" — discovering bibliography`);

  let works: Array<{ key: string; title: string; covers?: number[]; authors?: Array<{ key: string }> }> = [];

  // Try OL author works API if we have an OL key
  if (authorOlKey) {
    try {
      const url = `https://openlibrary.org/authors/${authorOlKey}/works.json?limit=50`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'tbra/1.0 (book-enrichment)' },
      });
      if (resp.ok) {
        const data = await resp.json() as { entries?: typeof works };
        works = data.entries ?? [];
      }
    } catch (err) {
      console.error(`[author-discovery] Failed to fetch works for ${authorName}:`, err);
    }
  }

  // Fallback: search OL by author name
  if (works.length === 0) {
    try {
      const searchResults = await searchOpenLibrary(authorName, 30);
      // Filter to only works by this author
      works = searchResults
        .filter(r => r.author_name?.some(a =>
          a.toLowerCase().includes(authorName.split(/\s+/).pop()?.toLowerCase() ?? '')
        ))
        .map(r => ({ key: r.key, title: r.title, covers: r.cover_i ? [r.cover_i] : undefined }));
    } catch (err) {
      console.error(`[author-discovery] Search fallback failed for ${authorName}:`, err);
    }
  }

  if (works.length === 0) {
    console.log(`[author-discovery] No OL works for "${authorName}" — trying Brave fallback`);

    try {
      const { braveSearch } = await import("./search");
      const braveResults = await braveSearch(`"${authorName}" books novels bibliography site:amazon.com OR site:goodreads.com`, 10);

      // Extract book titles from Brave results
      // Amazon format: "Book Title: Author, Name: ISBN: Amazon.com: Books"
      // Goodreads format: "Book Title by Author Name"
      const braveTitles = new Set<string>();
      const titlePatterns = [
        // Amazon: "Title (Series Book N)" or "Title: Author"
        /^([^:]+?)(?:\s*\([^)]+\))?\s*:\s*[A-Z]/,
        // Goodreads: "Title by Author"
        /^(.+?)\s+by\s+/i,
      ];

      for (const r of braveResults) {
        for (const pat of titlePatterns) {
          const match = r.title.match(pat);
          if (match) {
            const candidate = match[1].trim();
            // Skip if it's clearly not a book title
            if (candidate.length > 3 && candidate.length < 120
                && !candidate.toLowerCase().includes("amazon")
                && !candidate.toLowerCase().includes("goodreads")
                && !candidate.toLowerCase().includes("author page")) {
              braveTitles.add(candidate);
            }
            break;
          }
        }
      }

      if (braveTitles.size === 0) {
        console.log(`[author-discovery] Brave fallback found no titles for "${authorName}"`);
        return;
      }

      console.log(`[author-discovery] Brave found ${braveTitles.size} candidate titles for "${authorName}"`);

      // Pre-populate seen titles
      const existingBooks = await db.all(sql`
        SELECT b.title FROM books b
        JOIN book_authors ba ON ba.book_id = b.id
        WHERE ba.author_id = ${authorId}
      `) as { title: string }[];
      const seenTitles = new Set<string>();
      for (const eb of existingBooks) {
        seenTitles.add(eb.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
      }

      let braveImported = 0;
      for (const braveTitle of braveTitles) {
        if (braveImported >= MAX_BOOKS_PER_AUTHOR) break;

        const normTitle = braveTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seenTitles.has(normTitle)) continue;
        seenTitles.add(normTitle);

        if (isJunkTitle(braveTitle)) continue;
        if (!isEnglishTitle(braveTitle)) continue;

        const BOX_SET_PATTERNS = /\b(?:trilogy|duology|omnibus|box\s*set|boxed\s*set|collection|complete\s*series|bundle|compilation|compendium|volume\s*set)\b/i;
        if (BOX_SET_PATTERNS.test(braveTitle)) continue;

        // Check for duplicates
        const dupe = await findDuplicateBook({ title: braveTitle, authors: [authorName] });
        if (dupe) continue;

        // Search Google Books for metadata + cover
        try {
          const gbResp = await fetch(
            `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`${braveTitle} ${authorName}`)}&maxResults=3&key=${process.env.GOOGLE_BOOKS_API_KEY}`
          );
          if (!gbResp.ok) continue;
          const gbData = await gbResp.json();
          const gbItem = gbData.items?.[0];
          if (!gbItem) continue;

          const vol = gbItem.volumeInfo;
          // Verify the Google Books result actually matches our title
          const gbNorm = (vol.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (gbNorm !== normTitle && !gbNorm.includes(normTitle) && !normTitle.includes(gbNorm)) continue;

          const coverUrl = vol.imageLinks?.thumbnail?.replace("http://", "https://") ?? null;
          const year = vol.publishedDate ? parseInt(vol.publishedDate.slice(0, 4)) : null;
          const pages = vol.pageCount || null;
          const description = typeof vol.description === 'string' ? vol.description.slice(0, 500) : null;

          const bookId = crypto.randomUUID();
          await db.insert(books).values({
            id: bookId,
            title: braveTitle,
            description,
            publicationYear: year,
            pages,
            coverImageUrl: coverUrl,
            isFiction: true,
            language: 'English',
          });

          await db.insert(bookAuthors).values({ bookId, authorId }).onConflictDoNothing();

          // Generate SEO slug
          const { assignBookSlug } = await import("@/lib/utils/slugify");
          await assignBookSlug(bookId, braveTitle, authorName);

          braveImported++;
          console.log(`[author-discovery] Imported "${braveTitle}" via Brave+GBooks fallback (${braveImported}/${MAX_BOOKS_PER_AUTHOR})`);
          await sleep(DELAY_MS);
        } catch (err) {
          console.warn(`[author-discovery] GBooks lookup failed for "${braveTitle}":`, err);
        }
      }

      console.log(`[author-discovery] Brave fallback imported ${braveImported} books for "${authorName}"`);
    } catch (err) {
      console.error(`[author-discovery] Brave fallback error for "${authorName}":`, err);
    }
    return;
  }

  console.log(`[author-discovery] Found ${works.length} candidate works for "${authorName}"`);

  // Build a profile of the seed book (the one that triggered discovery) so we
  // can reject works OpenLibrary has mis-attributed to a conflated same-name
  // author record. Two extra OL calls total, not per-work.
  const [seed] = await db.all(sql`
    SELECT b.open_library_key as olKey, b.is_fiction as isFiction, b.publication_year as year
    FROM books b JOIN book_authors ba ON ba.book_id = b.id
    WHERE ba.author_id = ${authorId} LIMIT 1
  `) as { olKey: string | null; isFiction: number | null; year: number | null }[];
  const seedIsFiction = seed?.isFiction ?? null;
  let seedTokens = new Set<string>();
  if (seed?.olKey) {
    try {
      const seedDetails = await fetchOpenLibraryWork(seed.olKey);
      seedTokens = subjectTokens(seedDetails.subjects);
      await sleep(DELAY_MS);
    } catch {
      // No seed subjects — coherence gate falls back to era / fiction class.
    }
  }

  // Publish-year is the strongest conflation signal: a genuine author's
  // bibliography spans a single career (~decades), whereas a conflated record
  // can span centuries (e.g. a 1790s chemist + a 2000s novelist sharing a name).
  // We only need it for works that carry NO usable subjects — those are the ones
  // subject overlap can't judge — so the year lookup happens lazily in the loop.
  let seedYear = seed?.year ?? null;
  if (seedYear == null && seed?.olKey) {
    seedYear = await fetchEarliestPublishYear(seed.olKey);
    await sleep(DELAY_MS);
  }
  const ERA_WINDOW = 70; // years either side of the seed a single career can plausibly span
  let rejectedIncoherent = 0;

  let imported = 0;
  const seenTitles = new Set<string>();

  // Pre-populate with existing books by this author
  const existingBooks = await db.all(sql`
    SELECT b.title FROM books b
    JOIN book_authors ba ON ba.book_id = b.id
    WHERE ba.author_id = ${authorId}
  `) as { title: string }[];
  for (const eb of existingBooks) {
    seenTitles.add(eb.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
  }

  for (const work of works) {
    if (imported >= MAX_BOOKS_PER_AUTHOR) break;

    const title = work.title;

    // Gate 1: Skip junk titles
    if (isJunkTitle(title)) continue;

    // Gate 2: Skip non-English titles
    if (!isEnglishTitle(title)) continue;

    // Gate 3: Skip if normalized title already seen
    const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenTitles.has(normTitle)) continue;
    seenTitles.add(normTitle);

    // Gate 4: Skip anthologies (>3 authors)
    if (work.authors && work.authors.length > 3) continue;

    // Gate 5: Check for duplicates in DB
    const dupe = await findDuplicateBook({
      title,
      authors: [authorName],
      olKey: work.key,
    });
    if (dupe) {
      console.log(`[author-discovery] Skipping "${title}" — duplicate of "${dupe.existingTitle}"`);
      continue;
    }

    // Gate 6: Skip box sets / collections
    const BOX_SET_PATTERNS = /\b(?:trilogy|duology|omnibus|box\s*set|boxed\s*set|collection|complete\s*series|bundle|compilation|compendium|volume\s*set)\b/i;
    if (BOX_SET_PATTERNS.test(title)) continue;

    // Import this book
    try {
      // Fetch work details
      const workDetails = await fetchOpenLibraryWork(work.key);
      await sleep(DELAY_MS);

      // Find cover
      let coverUrl: string | null = null;
      if (work.covers && work.covers.length > 0) {
        coverUrl = buildCoverUrl(work.covers[0]);
      } else {
        const englishCover = await findEnglishCover(work.key);
        if (englishCover.coverId) coverUrl = buildCoverUrl(englishCover.coverId, "L");
      }

      // Extract description (fetchOpenLibraryWork returns description as string | null)
      const description: string | null = workDetails?.description ?? null;

      // Gate 7: If description exists but isn't English, skip this work
      // This catches foreign-language editions that have English-looking titles
      if (description && !isEnglishTitle(description.substring(0, 100))) {
        console.log(`[author-discovery] Skipping "${title}" — non-English description detected`);
        continue;
      }

      // Extract genres
      const genreNames = workDetails?.subjects
        ? normalizeGenres(workDetails.subjects)
        : [];

      // Determine fiction/nonfiction
      const subjectsLower = (workDetails?.subjects ?? []).map((s: string) => s.toLowerCase());
      const isFiction = subjectsLower.some((s: string) => s.includes('fiction')) ||
                        !subjectsLower.some((s: string) => s.includes('nonfiction') || s.includes('non-fiction'));

      // Gate 8: Author coherence. Reject works that don't match the seed book's
      // profile — guards against OpenLibrary author-record conflation (multiple
      // real people sharing a name lumped under one key). A work is rejected if
      // its fiction/nonfiction class disagrees with the seed, OR if both the seed
      // and the work carry subject tokens yet share none. Works with no subjects
      // pass on the class check alone (we can't disprove them).
      const workTokens = subjectTokens(workDetails?.subjects ?? []);
      const classMismatch = seedIsFiction != null && (isFiction ? 1 : 0) !== seedIsFiction;
      const subjectMismatch =
        seedTokens.size > 0 && workTokens.size > 0 &&
        ![...workTokens].some((t) => seedTokens.has(t));
      // Era check only for works with no usable subjects (where overlap can't
      // help) — fetch the work's earliest year lazily and compare to the seed.
      // For these subject-less works we favor precision: if we know the seed's
      // era but can't date the work at all, treat it as unverifiable and drop it
      // (it can still enter the catalog later via the primary subject importer).
      let eraMismatch = false;
      if (!classMismatch && !subjectMismatch && workTokens.size === 0 && seedYear != null) {
        const workYear = await fetchEarliestPublishYear(work.key);
        await sleep(DELAY_MS);
        eraMismatch = workYear == null || Math.abs(workYear - seedYear) > ERA_WINDOW;
      }
      if (eraMismatch || classMismatch || subjectMismatch) {
        rejectedIncoherent++;
        console.log(`[author-discovery] Skipping "${title}" — doesn't match author profile (likely OL name collision)`);
        continue;
      }

      // Create book
      const bookId = crypto.randomUUID();
      await db.insert(books).values({
        id: bookId,
        title,
        description,
        coverImageUrl: coverUrl,
        openLibraryKey: work.key,
        isFiction,
        language: 'English',
        coverSource: coverUrl ? 'openlibrary' : undefined,
        coverVerified: !!coverUrl,
      });

      // Link author
      await db.insert(bookAuthors).values({
        bookId,
        authorId,
      }).onConflictDoNothing();

      // Link genres
      for (const gn of genreNames.slice(0, 6)) {
        const genre = await db.query.genres.findFirst({
          where: eq(genresTable.name, gn),
          columns: { id: true },
        });
        if (genre) {
          await db.insert(bookGenres).values({
            bookId,
            genreId: genre.id,
          }).onConflictDoNothing();
        }
      }

      // Generate SEO slug
      const { assignBookSlug } = await import("@/lib/utils/slugify");
      await assignBookSlug(bookId, title, authorName);

      imported++;
      console.log(`[author-discovery] Imported "${title}" by "${authorName}" (${imported}/${MAX_BOOKS_PER_AUTHOR})`);
    } catch (err) {
      console.error(`[author-discovery] Failed to import "${title}":`, err);
    }
  }

  console.log(`[author-discovery] Done: imported ${imported} books for "${authorName}"${rejectedIncoherent ? ` (rejected ${rejectedIncoherent} as off-profile / likely name collision)` : ""}`);
}
