import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { books, bookAuthors, bookGenres, authors, genres } from "@/db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import {
  searchOpenLibrary,
  fetchOpenLibraryWork,
  buildCoverUrl,
  normalizeGenres,
  findOldestHardcoverCover,
} from "@/lib/openlibrary";
import { findOrCreateAuthor } from "@/lib/actions/books";
import { enrichBook } from "@/lib/enrichment/enrich-book";

const OL_DELAY_MS = 500;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function detectIsFiction(genreNames: string[]): boolean {
  const NONFICTION = new Set([
    "Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime", "Philosophy",
    "History", "Science", "Psychology",
  ]);
  return !genreNames.some((g) => NONFICTION.has(g));
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Find all books without OL keys
  const booksWithoutOL = await db
    .select({
      id: books.id,
      title: books.title,
    })
    .from(books)
    .where(isNull(books.openLibraryKey));

  // Get author names for each book
  const results: { title: string; status: string; olKey?: string }[] = [];
  let matched = 0;
  let failed = 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const book of booksWithoutOL) {
        try {
          // Get author
          const authorRow = await db
            .select({ name: authors.name })
            .from(bookAuthors)
            .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
            .where(eq(bookAuthors.bookId, book.id))
            .get();

          const authorName = authorRow?.name ?? "";
          const query = authorName ? `${book.title} ${authorName}` : book.title;

          await delay(OL_DELAY_MS);
          const searchResults = await searchOpenLibrary(query, 5);

          // More lenient matching — just check title similarity
          const normTitle = normalize(book.title);
          const match = searchResults.find((r) => {
            const normResult = normalize(r.title);
            if (normResult === normTitle) return true;
            if (normResult.includes(normTitle) || normTitle.includes(normResult)) return true;
            // Word overlap
            const resultWords = normResult.split(" ");
            const titleWords = normTitle.split(" ");
            const resultSet = new Set(resultWords);
            const titleSet = new Set(titleWords);
            const overlapFromTitle = titleWords.filter((w) => resultSet.has(w)).length;
            const overlapFromResult = resultWords.filter((w) => titleSet.has(w)).length;
            return (
              titleWords.length > 0 &&
              resultWords.length > 0 &&
              overlapFromTitle / titleWords.length >= 0.5 &&
              overlapFromResult / resultWords.length >= 0.4
            );
          });

          if (match) {
            // Fetch work details
            await delay(200);
            const work = await fetchOpenLibraryWork(match.key);
            const { coverId: hcCoverId, year: edYear } = await findOldestHardcoverCover(match.key);
            const coverUrl =
              buildCoverUrl(hcCoverId, "L") ??
              buildCoverUrl(work.coverId, "L") ??
              buildCoverUrl(match.cover_i, "L");

            const genreNames = normalizeGenres(work.subjects);
            const isFiction = detectIsFiction(genreNames);
            const bookTitle = work.title || match.title;

            // Update existing book record
            await db.update(books).set({
              title: bookTitle,
              description: work.description,
              publicationYear: match.first_publish_year ?? edYear,
              isbn13: match.isbn?.find((i: string) => i.length === 13) ?? null,
              isbn10: match.isbn?.find((i: string) => i.length === 10) ?? null,
              pages: match.number_of_pages_median,
              coverImageUrl: coverUrl,
              openLibraryKey: match.key,
              isFiction,
            }).where(eq(books.id, book.id));

            // Add genres if none exist
            const existingGenres = await db
              .select()
              .from(bookGenres)
              .where(eq(bookGenres.bookId, book.id));

            if (existingGenres.length === 0) {
              for (const genreName of genreNames) {
                let genre = await db.query.genres.findFirst({
                  where: eq(genres.name, genreName),
                });
                if (!genre) {
                  [genre] = await db.insert(genres).values({ name: genreName }).returning();
                }
                await db.insert(bookGenres).values({ bookId: book.id, genreId: genre.id }).onConflictDoNothing();
              }
            }

            // Trigger enrichment (non-blocking, respects pause)
            if (process.env.ENRICHMENT_PAUSED !== "true") {
              enrichBook(book.id).catch((err) => {
                console.error(`[backfill] Enrichment error for "${book.title}":`, err);
              });
            }

            matched++;
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "match", title: book.title, olKey: match.key }) + "\n")
            );
          } else {
            failed++;
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "no_match", title: book.title }) + "\n")
            );
          }
        } catch (err) {
          failed++;
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "error",
                title: book.title,
                error: err instanceof Error ? err.message : "Unknown error",
              }) + "\n"
            )
          );
        }
      }

      controller.enqueue(
        encoder.encode(JSON.stringify({ type: "done", matched, failed, total: booksWithoutOL.length }) + "\n")
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
