import { db } from "@/db";
import {
  books,
  bookAuthors,
  authors,
  genres,
  bookGenres,
  bookCategoryRatings,
  taxonomyCategories,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { braveSearch } from "./search";
import { analyzeBookContent } from "./analyze";
import type { BookContext } from "./types";

export async function enrichBook(bookId: string): Promise<void> {
  console.log(`[enrichment] Starting enrichment for book ${bookId}`);

  // 1. Fetch book with authors and genres
  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });
  if (!book) {
    console.error(`[enrichment] Book ${bookId} not found`);
    return;
  }

  const bookAuthorRows = await db
    .select({ name: authors.name })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(eq(bookAuthors.bookId, bookId));

  const bookGenreRows = await db
    .select({ name: genres.name })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(eq(bookGenres.bookId, bookId));

  const authorNames = bookAuthorRows.map((r) => r.name);
  const genreNames = bookGenreRows.map((r) => r.name);
  const searchName = `"${book.title}" ${authorNames.join(" ")}`;

  console.log(`[enrichment] Searching for: ${searchName}`);

  // 2. Run two Brave searches in parallel
  const [warningResults, reviewResults] = await Promise.all([
    braveSearch(`${searchName} content warnings trigger warnings`, 8),
    braveSearch(`${searchName} book review content themes`, 8),
  ]);

  const allResults = [...warningResults, ...reviewResults];
  console.log(`[enrichment] Found ${allResults.length} search results`);

  // 3. Analyze with Grok
  const context: BookContext = {
    title: book.title,
    authors: authorNames,
    description: book.description,
    genres: genreNames,
    isFiction: book.isFiction ?? true,
    searchResults: allResults,
  };

  const result = await analyzeBookContent(context);
  console.log(`[enrichment] Analysis complete for "${book.title}"`);

  // 4. Write results to DB

  // Update summary (only if not already human-set)
  if (!book.summary && result.summary) {
    await db
      .update(books)
      .set({ summary: result.summary, updatedAt: new Date().toISOString() })
      .where(eq(books.id, bookId));
  }

  // Update isFiction if analysis disagrees
  if (result.isFiction !== (book.isFiction ?? true)) {
    await db
      .update(books)
      .set({
        isFiction: result.isFiction,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(books.id, bookId));
    console.log(
      `[enrichment] Updated isFiction: ${book.isFiction} → ${result.isFiction}`
    );
  }

  // Add supplemental genre tags (skip bare Fiction/Nonfiction — tracked by isFiction)
  const SKIP_TAGS = new Set(["Fiction", "Nonfiction", "Non-Fiction"]);
  // Normalize common tag variants to match existing genre names
  const TAG_NORMALIZE: Record<string, string> = {
    "Science Fiction": "Sci-Fi",
    "Sci-fi": "Sci-Fi",
    "science fiction": "Sci-Fi",
  };
  for (let tagName of result.supplementalTags) {
    tagName = TAG_NORMALIZE[tagName] ?? tagName;
    if (SKIP_TAGS.has(tagName)) continue;
    // Check if genre already exists for this book
    let genre = await db.query.genres.findFirst({
      where: eq(genres.name, tagName),
    });
    if (!genre) {
      const [created] = await db
        .insert(genres)
        .values({ name: tagName })
        .returning();
      genre = created;
    }

    // Check if already linked
    const existing = await db
      .select()
      .from(bookGenres)
      .where(
        and(eq(bookGenres.bookId, bookId), eq(bookGenres.genreId, genre.id))
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(bookGenres).values({
        bookId,
        genreId: genre.id,
      });
      console.log(`[enrichment] Added tag: ${tagName}`);
    }
  }

  // Upsert content ratings
  const allCategories = await db.select().from(taxonomyCategories);
  const categoryMap = new Map(allCategories.map((c) => [c.key, c.id]));

  for (const rating of result.ratings) {
    const categoryId = categoryMap.get(rating.categoryKey);
    if (!categoryId) {
      console.warn(
        `[enrichment] Unknown category key: ${rating.categoryKey}, skipping`
      );
      continue;
    }

    // Check for existing rating
    const existing = await db
      .select()
      .from(bookCategoryRatings)
      .where(
        and(
          eq(bookCategoryRatings.bookId, bookId),
          eq(bookCategoryRatings.categoryId, categoryId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Only overwrite if existing is ai_inferred (don't overwrite human-verified)
      if (existing[0].evidenceLevel === "ai_inferred") {
        await db
          .update(bookCategoryRatings)
          .set({
            intensity: rating.intensity,
            notes: rating.notes,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(bookCategoryRatings.id, existing[0].id));
      }
    } else {
      await db.insert(bookCategoryRatings).values({
        bookId,
        categoryId,
        intensity: rating.intensity,
        notes: rating.notes,
        evidenceLevel: "ai_inferred",
      });
    }
  }

  console.log(`[enrichment] Enrichment complete for "${book.title}"`);
}
