import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { books, userNotifications } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { searchOpenLibrary, type OLSearchResult } from "@/lib/openlibrary";
import { importFromOpenLibraryAndReturn } from "@/lib/actions/books";
import { enrichBook } from "@/lib/enrichment/enrich-book";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

const OL_DELAY_MS = 150;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:;–—]\s*.+$/, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGoodMatch(resultTitle: string, bookTitle: string): boolean {
  const normResult = normalizeTitle(resultTitle);
  const normRow = normalizeTitle(bookTitle);

  if (normResult === normRow) return true;
  if (normResult.includes(normRow) && normResult.length <= normRow.length * 1.5) return true;
  if (normRow.includes(normResult) && normRow.length <= normResult.length * 1.5) return true;

  const resultWords = normResult.split(" ");
  const rowWords = normRow.split(" ");
  const resultSet = new Set(resultWords);
  const rowSet = new Set(rowWords);
  const matchesFromRow = rowWords.filter((w) => resultSet.has(w)).length;
  const matchesFromResult = resultWords.filter((w) => rowSet.has(w)).length;

  if (
    rowWords.length > 0 &&
    resultWords.length > 0 &&
    matchesFromRow / rowWords.length >= 0.6 &&
    matchesFromResult / resultWords.length >= 0.6
  ) {
    return true;
  }

  return false;
}

/**
 * Phase 2: Background enrichment endpoint.
 * Accepts a list of book IDs, runs OL search + enrichment for each.
 * Runs independently — user can navigate away.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { bookIds: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { bookIds } = body;
  if (!Array.isArray(bookIds) || bookIds.length === 0) {
    return new Response(JSON.stringify({ error: "No book IDs provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Return immediately — enrichment runs in the background via waitUntil-style pattern
  // We use a streaming response that closes quickly but kicks off background work
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send immediate acknowledgment
      controller.enqueue(
        encoder.encode(JSON.stringify({ status: "started", count: bookIds.length }) + "\n")
      );
      controller.close();

      // Background enrichment — runs after response is sent
      let enriched = 0;
      let failed = 0;

      for (const bookId of bookIds) {
        try {
          // Look up the book to get title, ISBN, author for OL search
          const book = await db
            .select()
            .from(books)
            .where(eq(books.id, bookId))
            .get();

          if (!book) {
            failed++;
            continue;
          }

          // Get author name for search
          const authorRows = await db.all(sql`
            SELECT a.name FROM authors a
            JOIN book_authors ba ON a.id = ba.author_id
            WHERE ba.book_id = ${bookId}
            LIMIT 1
          `) as { name: string }[];
          const authorName = authorRows[0]?.name ?? null;

          let olMatch: OLSearchResult | undefined;

          // Try ISBN lookup first
          const isbn = book.isbn13 || book.isbn10;
          if (isbn) {
            await delay(OL_DELAY_MS);
            const isbnResults = await searchOpenLibrary(isbn, 5);
            olMatch = isbnResults.find((r) => isGoodMatch(r.title, book.title));
            if (!olMatch && isbnResults.length > 0) {
              olMatch = isbnResults[0];
            }
          }

          // Fallback to title+author text search
          if (!olMatch) {
            const query = authorName
              ? `${book.title} ${authorName}`
              : book.title;
            await delay(OL_DELAY_MS);
            const results = await searchOpenLibrary(query, 5);
            olMatch = results.find((r) => isGoodMatch(r.title, book.title));
          }

          if (olMatch) {
            // Import via OL — this upgrades the minimal record with full metadata
            await importFromOpenLibraryAndReturn(olMatch);
          }

          // Run enrichment (covers, descriptions, etc.)
          await enrichBook(bookId, { skipGoogleBooks: true });
          enriched++;
        } catch (err) {
          console.error(`[enrich-batch] Error enriching book ${bookId}:`, err);
          failed++;
        }
      }

      // Create in-app notification when done
      try {
        await db.insert(userNotifications).values({
          userId: user.userId,
          type: "import_complete",
          title: "Import complete",
          message: `Your library import is ready! All book details, covers, and content ratings have been added. (${enriched} enriched${failed > 0 ? `, ${failed} failed` : ""})`,
        });
      } catch (err) {
        console.error("[enrich-batch] Failed to create notification:", err);
      }

      console.log(`[enrich-batch] Done: ${enriched} enriched, ${failed} failed out of ${bookIds.length}`);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
