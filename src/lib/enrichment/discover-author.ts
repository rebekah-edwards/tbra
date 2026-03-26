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
  normalizeGenres, findEnglishCover, isJunkTitle,
} from "@/lib/openlibrary";
import { isEnglishTitle } from "@/lib/queries/books";
import { findDuplicateBook } from "./dedup";

const MAX_BOOKS_PER_AUTHOR = 30;
const DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

      // Extract genres
      const genreNames = workDetails?.subjects
        ? normalizeGenres(workDetails.subjects)
        : [];

      // Determine fiction/nonfiction
      const subjectsLower = (workDetails?.subjects ?? []).map((s: string) => s.toLowerCase());
      const isFiction = subjectsLower.some((s: string) => s.includes('fiction')) ||
                        !subjectsLower.some((s: string) => s.includes('nonfiction') || s.includes('non-fiction'));

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

  console.log(`[author-discovery] Done: imported ${imported} books for "${authorName}"`);
}
