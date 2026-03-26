/**
 * Populate incomplete series: for series with only 1 book, search OL
 * for other books by the same author and import+link them.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db";
import {
  books,
  bookSeries,
  series,
  bookAuthors,
  authors,
  bookGenres,
  genres,
} from "../src/db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  searchOpenLibrary,
  fetchOpenLibraryWork,
  buildCoverUrl,
  normalizeGenres,
  findOldestHardcoverCover,
  findEnglishEditionTitle,
} from "../src/lib/openlibrary";
import { enrichBook } from "../src/lib/enrichment/enrich-book";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NONFICTION_GENRES = new Set([
  "Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime", "Philosophy",
]);

const BOX_SET_PATTERNS = [
  /\bbox\s*set\b/i,
  /\bcollection\s+(set|of)\b/i,
  /\b(books?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(volumes?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(omnibus|anthology|compendium|complete\s+series)\b/i,
  /\b\d+\s*-?\s*book\s+(set|bundle|pack)\b/i,
];

function isBoxSet(title: string): boolean {
  return BOX_SET_PATTERNS.some((p) => p.test(title));
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:;]\s*.*/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/^(the|a|an|la|le|les|el|los|las|die|der|das)\s+/i, "")
    .replace(/[''"`\-–—,!?.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log("=== POPULATING INCOMPLETE SERIES ===");

  // Find series with <= 2 books
  const incompleteSeries = await db.all(sql`
    SELECT s.id, s.name, COUNT(bs.book_id) as book_count
    FROM series s
    JOIN book_series bs ON s.id = bs.series_id
    GROUP BY s.id
    HAVING COUNT(bs.book_id) <= 2
    ORDER BY s.name
  `) as { id: string; name: string; book_count: number }[];

  console.log(`Found ${incompleteSeries.length} incomplete series`);

  for (const s of incompleteSeries) {
    console.log(`\n--- Series: "${s.name}" (${s.book_count} books) ---`);

    // Get the existing book(s) in this series to find the author
    const existingBooks = await db
      .select({
        bookId: bookSeries.bookId,
        title: books.title,
      })
      .from(bookSeries)
      .innerJoin(books, eq(bookSeries.bookId, books.id))
      .where(eq(bookSeries.seriesId, s.id));

    if (existingBooks.length === 0) continue;

    // Get authors of the first book
    const bookAuthorRows = await db
      .select({ name: authors.name, olKey: authors.openLibraryKey })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, existingBooks[0].bookId));

    const authorNames = bookAuthorRows.map((a) => a.name);
    if (authorNames.length === 0) {
      console.log("  No authors found, skipping");
      continue;
    }

    // Search OL for the series name + author
    const query = `${s.name} ${authorNames[0]}`;
    console.log(`  Searching: "${query}"`);

    await delay(400);
    const results = await searchOpenLibrary(query, 30);
    console.log(`  Found ${results.length} results`);

    // Track seen titles to avoid importing foreign editions as dupes
    const seenTitles = new Set<string>();
    for (const eb of existingBooks) {
      seenTitles.add(normalizeTitle(eb.title));
    }

    let imported = 0;
    for (const result of results) {
      // Skip box sets
      if (isBoxSet(result.title)) {
        console.log(`  Skipping box set: "${result.title}"`);
        continue;
      }

      // Skip duplicate titles (foreign editions)
      const normTitle = normalizeTitle(result.title);
      if (seenTitles.has(normTitle)) {
        console.log(`  Skipping duplicate title: "${result.title}"`);
        continue;
      }

      // Only import books by the same author
      const resultAuthors = result.author_name ?? [];
      const sharesAuthor = resultAuthors.some((ra) =>
        authorNames.some((ka) => ka.toLowerCase() === ra.toLowerCase())
      );
      if (!sharesAuthor) continue;

      // Check if already in DB
      const existing = await db.query.books.findFirst({
        where: eq(books.openLibraryKey, result.key),
      });

      if (existing) {
        seenTitles.add(normalizeTitle(existing.title));
        // Link to series if not already linked
        const existingLink = await db
          .select()
          .from(bookSeries)
          .where(and(eq(bookSeries.bookId, existing.id), eq(bookSeries.seriesId, s.id)))
          .limit(1);

        if (existingLink.length === 0) {
          await db.insert(bookSeries).values({
            bookId: existing.id,
            seriesId: s.id,
            positionInSeries: null,
          }).onConflictDoNothing();
          console.log(`  Linked existing: "${existing.title}"`);
        }
        continue;
      }

      seenTitles.add(normTitle);

      // Import the book
      try {
        await delay(400);
        const work = await fetchOpenLibraryWork(result.key);
        const { coverId: hardcoverCoverId, year: editionYear } = await findOldestHardcoverCover(result.key);
        const coverUrl =
          buildCoverUrl(hardcoverCoverId, "L") ??
          buildCoverUrl(work.coverId, "L") ??
          buildCoverUrl(result.cover_i, "L");
        const genreNames = normalizeGenres(work.subjects);
        const isFiction = !genreNames.some((g) => NONFICTION_GENRES.has(g));

        // Resolve English title for foreign-language works
        const englishTitle = await findEnglishEditionTitle(result.key);

        const [newBook] = await db
          .insert(books)
          .values({
            title: englishTitle ?? result.title,
            description: work.description,
            publicationYear: result.first_publish_year ?? editionYear,
            isbn13: result.isbn?.find((i) => i.length === 13) ?? null,
            isbn10: result.isbn?.find((i) => i.length === 10) ?? null,
            pages: result.number_of_pages_median,
            coverImageUrl: coverUrl,
            openLibraryKey: result.key,
            isFiction,
          })
          .returning();

        // Link authors
        for (let i = 0; i < resultAuthors.length; i++) {
          const name = resultAuthors[i];
          const olKey = result.author_key?.[i];
          let author = await db.query.authors.findFirst({ where: eq(authors.name, name) });
          if (!author) {
            [author] = await db.insert(authors).values({ name, openLibraryKey: olKey ?? null }).returning();
          }
          await db.insert(bookAuthors).values({ bookId: newBook.id, authorId: author.id }).onConflictDoNothing();
        }

        // Link genres
        for (const genreName of genreNames) {
          let genre = await db.query.genres.findFirst({ where: eq(genres.name, genreName) });
          if (!genre) {
            [genre] = await db.insert(genres).values({ name: genreName }).returning();
          }
          await db.insert(bookGenres).values({ bookId: newBook.id, genreId: genre.id }).onConflictDoNothing();
        }

        // Link to series
        await db.insert(bookSeries).values({
          bookId: newBook.id,
          seriesId: s.id,
          positionInSeries: null,
        });

        imported++;
        console.log(`  Imported: "${result.title}"`);

        // Enrich (will set proper series position)
        enrichBook(newBook.id).catch((err) => {
          console.warn(`  Enrichment failed for "${result.title}":`, err);
        });

        if (imported >= 10) break; // Cap per series
      } catch (err) {
        console.warn(`  Failed to import "${result.title}":`, err);
      }
    }

    console.log(`  Imported ${imported} new books for "${s.name}"`);
  }

  console.log("\n=== DONE ===");
  // Wait for any pending enrichments
  await delay(5000);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
