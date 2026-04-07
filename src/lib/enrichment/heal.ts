/**
 * Healing pass — re-evaluates already-enriched books for known quality issues.
 * Safe to re-run; idempotent per book.
 *
 * Checks:
 *  1. Title normalization (junk suffixes, capitalization)
 *  2. Description sanitization (strip HTML/links/URLs, null out non-English)
 *  3. Summary quality (AI rewrite if >190 chars or mid-sentence, flag <50)
 *  4. Cover quality (HEAD validation, re-cascade for OL covers)
 *  5. Genre normalization (title-case, merge duplicates)
 *  6. Publication year correction (use earliest edition year from OL, not edition date)
 *  7. Enrichment gap filling (trigger full enrichment for missing data)
 */

import { db } from "@/db";
import {
  books,
  bookAuthors,
  authors,
  genres,
  bookGenres,
  bookCategoryRatings,
  enrichmentLog,
  links,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  sanitizeDescription,
  normalizeTitle as normalizeTitleSanitize,
  isJunkEntry,
  titleCaseGenre,
  looksNonEnglish,
  truncateSummary,
} from "./sanitize";
import {
  findEnglishCover,
  buildCoverUrl,
  findIsbnCover,
  fetchEarliestPublishYear,
  fetchWorkEditions,
  fetchWorkDescription,
} from "@/lib/openlibrary";
import { findGoogleBooksCover } from "@/lib/google-books";
import { findAmazonCover } from "@/lib/amazon-covers";
import { braveSearch } from "./search";
import { enrichBook } from "./enrich-book";
import OpenAI from "openai";

export interface HealResult {
  bookId: string;
  title: string;
  fixes: string[];
  errors: string[];
}

/**
 * Heal a single book: run all quality checks and apply fixes.
 */
export async function healBook(bookId: string): Promise<HealResult> {
  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });
  if (!book) {
    return { bookId, title: "(not found)", fixes: [], errors: [`Book ${bookId} not found`] };
  }

  const result: HealResult = { bookId, title: book.title, fixes: [], errors: [] };

  const bookAuthorRows = await db
    .select({ name: authors.name })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(eq(bookAuthors.bookId, bookId));
  const authorNames = bookAuthorRows.map((r) => r.name);

  // ── 1. Title normalization ──
  try {
    await healTitle(book, result);
  } catch (err) {
    result.errors.push(`Title heal error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 2. Description sanitization ──
  try {
    await healDescription(book, result);
  } catch (err) {
    result.errors.push(`Description heal error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 3. Summary length enforcement ──
  try {
    await healSummary(book, result);
  } catch (err) {
    result.errors.push(`Summary heal error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 4. Cover quality check ──
  try {
    await healCover(book, authorNames, result);
  } catch (err) {
    result.errors.push(`Cover heal error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 5. Genre normalization ──
  try {
    await healGenres(bookId, result);
  } catch (err) {
    result.errors.push(`Genre heal error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 6. Publication year correction (use original publish date, not edition date) ──
  try {
    await healPublicationYear(book, result);
  } catch (err) {
    result.errors.push(`Publication year heal error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 6b. Publisher backfill (fetch from OL editions if missing) ──
  try {
    await healPublisher(book, result);
  } catch (err) {
    result.errors.push(`Publisher heal error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 7. Fill enrichment gaps (description, audiobook length, summary, content ratings) ──
  // Re-read the book since earlier steps may have changed it
  const refreshedBook = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (refreshedBook) {
    const needsEnrichment =
      !refreshedBook.summary ||
      !refreshedBook.description ||
      !refreshedBook.audioLengthMinutes;

    // Also check if content ratings exist
    const ratingCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(bookCategoryRatings)
      .where(eq(bookCategoryRatings.bookId, bookId));
    const hasRatings = (ratingCount[0]?.count ?? 0) > 0;

    if (needsEnrichment || !hasRatings) {
      try {
        const missing: string[] = [];
        if (!refreshedBook.summary) missing.push("summary");
        if (!refreshedBook.description) missing.push("description");
        if (!refreshedBook.audioLengthMinutes) missing.push("audio length");
        if (!hasRatings) missing.push("content ratings");
        result.fixes.push(`Enrichment: triggered for missing ${missing.join(", ")}`);
        await enrichBook(bookId);
      } catch (err) {
        result.errors.push(`Enrichment error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(
    `[heal] "${result.title}" — ${result.fixes.length} fixes${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`
  );
  return result;
}

// ─── Title ─────────────────────────────────────────────────

type BookRow = NonNullable<Awaited<ReturnType<typeof db.query.books.findFirst>>>;

async function healTitle(book: BookRow, result: HealResult): Promise<void> {
  // Check for junk entry — log but don't delete (leave deletion to admin)
  if (isJunkEntry(book.title)) {
    result.fixes.push(`JUNK_ENTRY: "${book.title}" — flagged for manual review`);
    await db.insert(enrichmentLog).values({
      bookId: book.id,
      status: "needs_review",
      errorMessage: `Junk entry detected: "${book.title}"`,
    }).onConflictDoNothing();
    return;
  }

  const normalized = normalizeTitleSanitize(book.title);
  if (normalized !== book.title) {
    await db
      .update(books)
      .set({ title: normalized, updatedAt: new Date().toISOString() })
      .where(eq(books.id, book.id));
    result.fixes.push(`Title: "${book.title}" → "${normalized}"`);
  }
}

// ─── Description ───────────────────────────────────────────

async function healDescription(book: BookRow, result: HealResult): Promise<void> {
  // If no description, try to fetch from OL work page
  if (!book.description && book.openLibraryKey) {
    const olDesc = await fetchWorkDescription(book.openLibraryKey);
    if (olDesc) {
      const cleaned = sanitizeDescription(olDesc);
      if (cleaned && cleaned.length >= 50 && !looksNonEnglish(cleaned)) {
        await db
          .update(books)
          .set({ description: cleaned, updatedAt: new Date().toISOString() })
          .where(eq(books.id, book.id));
        result.fixes.push(`Description: fetched from OL (${cleaned.length} chars)`);
        return;
      }
    }
  }

  if (!book.description) return;

  // Check if description looks non-English → null it out for re-enrichment
  if (looksNonEnglish(book.description)) {
    await db
      .update(books)
      .set({ description: null, updatedAt: new Date().toISOString() })
      .where(eq(books.id, book.id));
    result.fixes.push(`Description: nulled non-English description (${book.description.length} chars)`);
    return;
  }

  // Sanitize HTML/links/URLs + junk patterns. Null result means unsalvageable.
  const desc = book.description;
  const sanitized = sanitizeDescription(desc);
  if (sanitized === null) {
    await db
      .update(books)
      .set({ description: null, updatedAt: new Date().toISOString() })
      .where(eq(books.id, book.id));
    result.fixes.push(`Description: nulled junk description (${desc.length} chars)`);
    return;
  }
  if (sanitized !== desc) {
    await db
      .update(books)
      .set({ description: sanitized, updatedAt: new Date().toISOString() })
      .where(eq(books.id, book.id));
    result.fixes.push(`Description: sanitized (${desc.length} → ${sanitized.length} chars)`);
  }

  // Detect truncated descriptions: end mid-sentence without proper punctuation,
  // or end with a dangling word (article, preposition, conjunction)
  const trimmedDesc = desc.trimEnd();
  const endsCleanly = /[.!?…"')»]$/.test(trimmedDesc);
  const endsDangling = /\b(?:the|a|an|their|his|her|its|my|your|our|and|but|or|with|in|on|at|to|for|of|from|by|as|that|this|which|who|while|is|are|was|were|has|have|had|will|would|can|could|may|might|shall|should)\s*$/.test(trimmedDesc);
  if (!endsCleanly || endsDangling) {
    await db
      .update(books)
      .set({ description: null, updatedAt: new Date().toISOString() })
      .where(eq(books.id, book.id));
    result.fixes.push(`Description: nulled truncated description (${trimmedDesc.length} chars, ends: "…${trimmedDesc.slice(-30)}")`);
  }
}

// ─── Summary ───────────────────────────────────────────────

async function healSummary(book: BookRow, result: HealResult): Promise<void> {
  if (!book.summary) return;

  // Flag very short summaries as needing re-enrichment
  if (book.summary.length < 50) {
    result.fixes.push(`Summary: flagged as too short (${book.summary.length} chars)`);
    await db.insert(enrichmentLog).values({
      bookId: book.id,
      status: "needs_review",
      errorMessage: `Short summary (${book.summary.length} chars): "${book.summary}"`,
    }).onConflictDoNothing();
    return;
  }

  // Check if summary needs fixing: too long OR ends mid-sentence
  // A summary ending in "their." or "the." etc. is a false positive for clean endings
  const trimmed = book.summary.trimEnd();
  const endsWithPunctuation = /[.!?…"']$/.test(trimmed);
  const endsMidSentence = /\b(?:the|a|an|their|his|her|its|my|your|our|and|but|or|with|in|on|at|to|for|of|from|by|as|that|this|which|who|while)\.\s*$/.test(trimmed);
  const endsCleanly = endsWithPunctuation && !endsMidSentence;
  if (book.summary.length > 190 || !endsCleanly) {
    // Use AI to rewrite the summary to ≤190 chars (not just truncate)
    const rewritten = await rewriteSummary(book.title, book.summary);
    if (rewritten && rewritten !== book.summary) {
      await db
        .update(books)
        .set({ summary: rewritten, updatedAt: new Date().toISOString() })
        .where(eq(books.id, book.id));
      result.fixes.push(`Summary: rewritten ${book.summary.length} → ${rewritten.length} chars`);
    } else if (!rewritten) {
      // AI rewrite failed — use mechanical truncation as last resort
      const truncated = truncateSummary(book.summary, 190);
      if (truncated !== book.summary) {
        await db
          .update(books)
          .set({ summary: truncated, updatedAt: new Date().toISOString() })
          .where(eq(books.id, book.id));
        result.fixes.push(`Summary: truncated ${book.summary.length} → ${truncated.length} chars (AI rewrite failed)`);
      }
    }
  }
}

/**
 * Use Grok to rewrite an oversized summary into ≤190 chars while preserving meaning.
 * Returns null if the API call fails.
 */
async function rewriteSummary(title: string, currentSummary: string): Promise<string | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("[heal] No XAI_API_KEY — skipping AI summary rewrite");
    return null;
  }

  try {
    const client = new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await client.chat.completions.create(
      {
        model: "grok-3-mini",
        messages: [
          {
            role: "user",
            content: `Rewrite this book summary to be 70-190 characters. Keep the core hook. No spoilers. Complete sentences only. Do not reference the research process. Output ONLY the new summary, nothing else.

Book: "${title}"
Current summary: "${currentSummary}"`,
          },
        ],
        temperature: 0.4,
        max_tokens: 100,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const rewritten = response.choices[0]?.message?.content?.trim();
    if (!rewritten || rewritten.length > 190 || rewritten.length < 50) {
      console.warn(`[heal] AI summary rewrite out of range (${rewritten?.length} chars): "${rewritten}"`);
      // If the AI returned something slightly over, use truncateSummary as a safety net
      if (rewritten && rewritten.length > 190) {
        return truncateSummary(rewritten, 190);
      }
      return null;
    }

    return rewritten;
  } catch (err) {
    console.warn(`[heal] AI summary rewrite failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Cover ─────────────────────────────────────────────────

async function healCover(
  book: BookRow,
  authorNames: string[],
  result: HealResult
): Promise<void> {
  // Skip if already verified
  if (book.coverVerified) return;

  // No cover at all — try to resolve one
  if (!book.coverImageUrl) {
    const newCover = await resolveCoverCascade(book, authorNames);
    if (newCover) {
      await db
        .update(books)
        .set({
          coverImageUrl: newCover.url,
          coverSource: newCover.source,
          coverVerified: true,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(books.id, book.id));
      result.fixes.push(`Cover: found via ${newCover.source}`);
    } else {
      result.fixes.push(`Cover: none found across all tiers`);
    }
    return;
  }

  // Has a cover — validate it with a HEAD request
  const isValid = await validateCoverUrl(book.coverImageUrl);

  if (!isValid) {
    // Cover is broken (404 or too small) — try to replace it
    result.fixes.push(`Cover: existing URL failed validation`);
    const newCover = await resolveCoverCascade(book, authorNames);
    if (newCover) {
      await db
        .update(books)
        .set({
          coverImageUrl: newCover.url,
          coverSource: newCover.source,
          coverVerified: true,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(books.id, book.id));
      result.fixes.push(`Cover: replaced with ${newCover.source}`);
    } else {
      // Clear the broken URL
      await db
        .update(books)
        .set({
          coverImageUrl: null,
          coverSource: null,
          coverVerified: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(books.id, book.id));
      result.fixes.push(`Cover: cleared broken URL, no replacement found`);
    }
    return;
  }

  // Cover is valid — mark as verified (don't speculatively hit Google Books for every OL cover)
  const source = detectCoverSource(book.coverImageUrl!);
  await db
    .update(books)
    .set({
      coverSource: source,
      coverVerified: true,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(books.id, book.id));
}

/**
 * HEAD-request a cover URL to check if it exists and is a real image.
 * Returns false if 404, redirect to generic placeholder, or Content-Length < 1000.
 */
async function validateCoverUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return false;

    // Check Content-Length (tiny images are placeholders)
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) < 1000) return false;

    // Check Content-Type is an image
    const contentType = res.headers.get("content-type");
    if (contentType && !contentType.startsWith("image/")) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Detect cover source from URL pattern.
 */
function detectCoverSource(url: string): string {
  if (url.includes("covers.openlibrary.org")) return "openlibrary";
  if (url.includes("books.google.com")) return "google_books";
  if (url.includes("m.media-amazon.com") || url.includes("images-na.ssl-images-amazon.com")) return "amazon";
  if (url.includes("i.gr-assets.com")) return "brave"; // found via Brave search, typically Goodreads
  if (url.startsWith("/uploads/")) return "manual";
  return "brave";
}

/**
 * Multi-tier cover resolution cascade.
 * Prioritizes Google Books over OL (better English cover selection).
 */
async function resolveCoverCascade(
  book: BookRow,
  authorNames: string[]
): Promise<{ url: string; source: string } | null> {
  // Tier 1: Google Books (best for English covers)
  try {
    const gbUrl = await findGoogleBooksCover({
      title: book.title,
      authors: authorNames,
      isbn13: book.isbn13,
      isbn10: book.isbn10,
      asin: book.asin,
    });
    if (gbUrl && (await validateCoverUrl(gbUrl))) {
      return { url: gbUrl, source: "google_books" };
    }
  } catch { /* continue */ }

  // Tier 2: OL ISBN cover
  if (book.isbn13) {
    const url = await findIsbnCover(book.isbn13);
    if (url && (await validateCoverUrl(url))) {
      return { url, source: "openlibrary" };
    }
  }
  if (book.isbn10) {
    const url = await findIsbnCover(book.isbn10);
    if (url && (await validateCoverUrl(url))) {
      return { url, source: "openlibrary" };
    }
  }

  // Tier 3: OL English edition cover
  if (book.openLibraryKey) {
    try {
      const { coverId } = await findEnglishCover(book.openLibraryKey);
      if (coverId) {
        const url = buildCoverUrl(coverId, "L");
        if (url && (await validateCoverUrl(url))) {
          return { url, source: "openlibrary" };
        }
      }
    } catch { /* continue */ }
  }

  // Tier 4: Brave Search for cover image
  try {
    const searchName = `"${book.title}" "${authorNames[0] ?? ""}"`;
    const coverResults = await braveSearch(`${searchName} book cover`, 5);
    for (const sr of coverResults) {
      const imgMatch = sr.description.match(/(https?:\/\/[^\s"<>]+\.(?:jpg|jpeg|png))/i);
      if (imgMatch) {
        const url = imgMatch[1];
        if (
          url.includes("m.media-amazon.com") ||
          url.includes("images-na.ssl-images-amazon.com") ||
          url.includes("i.gr-assets.com") ||
          url.includes("covers.openlibrary.org") ||
          url.includes("books.google.com") ||
          url.includes("bookshop.org")
        ) {
          if (await validateCoverUrl(url)) {
            return { url, source: "brave" };
          }
        }
      }
    }
  } catch { /* continue */ }

  // Tier 5: Amazon CDN direct
  try {
    const amazonLinks = await db
      .select({ url: links.url })
      .from(links)
      .where(and(eq(links.bookId, book.id), eq(links.type, "amazon")));

    const url = await findAmazonCover({
      asin: book.asin,
      amazonLinkUrls: amazonLinks.map((l) => l.url),
    });
    if (url && (await validateCoverUrl(url))) {
      return { url, source: "amazon" };
    }
  } catch { /* continue */ }

  return null;
}

// ─── Genres ────────────────────────────────────────────────

async function healGenres(bookId: string, result: HealResult): Promise<void> {
  const bookGenreRows = await db
    .select({ genreId: bookGenres.genreId, name: genres.name })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(eq(bookGenres.bookId, bookId));

  for (const { genreId, name } of bookGenreRows) {
    const titleCased = titleCaseGenre(name);
    if (titleCased === name) continue;

    // Check if the title-cased version already exists as a separate genre
    const existingTitleCased = await db.query.genres.findFirst({
      where: eq(genres.name, titleCased),
    });

    if (existingTitleCased && existingTitleCased.id !== genreId) {
      // Merge: re-point this book's link to the existing title-cased genre
      await db
        .delete(bookGenres)
        .where(and(eq(bookGenres.bookId, bookId), eq(bookGenres.genreId, genreId)));

      // Only add the new link if it doesn't already exist
      const alreadyLinked = bookGenreRows.some((r) => r.genreId === existingTitleCased.id);
      if (!alreadyLinked) {
        await db
          .insert(bookGenres)
          .values({ bookId, genreId: existingTitleCased.id })
          .onConflictDoNothing();
      }
      result.fixes.push(`Genre: merged "${name}" → existing "${titleCased}"`);
    } else if (!existingTitleCased) {
      // No conflict — just rename the genre in place
      await db
        .update(genres)
        .set({ name: titleCased })
        .where(eq(genres.id, genreId));
      result.fixes.push(`Genre: renamed "${name}" → "${titleCased}"`);
    }
  }

  // Ensure parent genres are linked for any sub-genres on this book
  // Re-fetch after potential merges above
  const updatedGenreRows = await db
    .select({ genreId: bookGenres.genreId, parentGenreId: genres.parentGenreId, name: genres.name })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(eq(bookGenres.bookId, bookId));

  const linkedGenreIds = new Set(updatedGenreRows.map((r) => r.genreId));
  for (const { parentGenreId, name } of updatedGenreRows) {
    if (parentGenreId && !linkedGenreIds.has(parentGenreId)) {
      await db
        .insert(bookGenres)
        .values({ bookId, genreId: parentGenreId })
        .onConflictDoNothing();
      linkedGenreIds.add(parentGenreId);
      const parent = await db.query.genres.findFirst({ where: eq(genres.id, parentGenreId) });
      result.fixes.push(`Genre: auto-linked parent "${parent?.name ?? parentGenreId}" for "${name}"`);
    }
  }
}

// ─── Publication Year ───────────────────────────────────────

async function healPublicationYear(book: BookRow, result: HealResult): Promise<void> {
  // Can only correct if we have an OL key to look up editions
  if (!book.openLibraryKey) return;

  const earliestYear = await fetchEarliestPublishYear(book.openLibraryKey);
  if (!earliestYear) return;

  // If the book has no year, or its year is newer than the earliest edition, fix it
  if (!book.publicationYear || book.publicationYear > earliestYear) {
    const oldYear = book.publicationYear;
    await db
      .update(books)
      .set({ publicationYear: earliestYear, updatedAt: new Date().toISOString() })
      .where(eq(books.id, book.id));
    result.fixes.push(`Publication year: ${oldYear ?? "null"} → ${earliestYear}`);
  }
}

// ─── Publisher ──────────────────────────────────────────────

/** Known "good" publishers to prefer when multiple editions exist */
const PREFERRED_PUBLISHERS = new Set([
  "Del Rey", "Tor Books", "Penguin", "Penguin Books", "Random House",
  "HarperCollins", "Simon & Schuster", "Hachette", "Macmillan",
  "Doubleday", "Knopf", "Vintage", "Scholastic", "Little, Brown",
  "Orbit", "DAW Books", "Ace Books", "Bantam", "Ballantine Books",
  "Crown", "Bloomsbury", "Viking", "Putnam", "Atria Books",
]);

async function healPublisher(book: BookRow, result: HealResult): Promise<void> {
  // Only backfill if publisher is missing
  if (book.publisher) return;
  if (!book.openLibraryKey) return;

  const { entries } = await fetchWorkEditions(book.openLibraryKey, 50);
  if (entries.length === 0) return;

  // Filter to English editions with publishers
  const englishWithPublisher = entries.filter((e) => {
    const lang = e.languages?.[0]?.key;
    const isEnglish = !lang || lang === "/languages/eng";
    return isEnglish && e.publishers && e.publishers.length > 0;
  });

  if (englishWithPublisher.length === 0) return;

  // Prefer a well-known publisher
  for (const edition of englishWithPublisher) {
    for (const pub of edition.publishers!) {
      if (PREFERRED_PUBLISHERS.has(pub)) {
        await db
          .update(books)
          .set({ publisher: pub, updatedAt: new Date().toISOString() })
          .where(eq(books.id, book.id));
        result.fixes.push(`Publisher: set to "${pub}" (from OL editions)`);
        return;
      }
    }
  }

  // Fallback: use the first English edition's first publisher
  const publisher = englishWithPublisher[0].publishers![0];
  await db
    .update(books)
    .set({ publisher, updatedAt: new Date().toISOString() })
    .where(eq(books.id, book.id));
  result.fixes.push(`Publisher: set to "${publisher}" (from OL editions)`);
}

// ─── Batch Healing ─────────────────────────────────────────

export interface HealBatchOptions {
  /** Max books to process. Default 50. */
  limit?: number;
  /** Only heal books that haven't been healed before. */
  skipAlreadyHealed?: boolean;
}

/**
 * Heal a batch of books in priority order:
 *  1. Books with unverified covers
 *  2. Books with descriptions (might need sanitization)
 *  3. Everything else
 */
export async function healBatch(options?: HealBatchOptions): Promise<HealResult[]> {
  const limit = options?.limit ?? 50;

  // Get books ordered by: unverified covers first, then by most recently updated
  const booksToHeal = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .orderBy(
      sql`${books.coverVerified} ASC`, // unverified first
      sql`${books.updatedAt} DESC`
    )
    .limit(limit)
    .all();

  console.log(`[heal] Starting batch heal of ${booksToHeal.length} books`);

  const results: HealResult[] = [];
  for (const book of booksToHeal) {
    try {
      const healResult = await healBook(book.id);
      results.push(healResult);
    } catch (err) {
      results.push({
        bookId: book.id,
        title: book.title,
        fixes: [],
        errors: [`Unhandled error: ${err instanceof Error ? err.message : String(err)}`],
      });
    }
  }

  const totalFixes = results.reduce((sum, r) => sum + r.fixes.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  console.log(`[heal] Batch complete: ${results.length} books, ${totalFixes} fixes, ${totalErrors} errors`);

  return results;
}
