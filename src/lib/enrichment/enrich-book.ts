import { db } from "@/db";
import { triggerEnrichment } from "./trigger";
import {
  books,
  bookAuthors,
  authors,
  genres,
  bookGenres,
  bookCategoryRatings,
  taxonomyCategories,
  series,
  bookSeries,
  enrichmentLog,
  links,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { braveSearch } from "./search";
import { analyzeBookContent } from "./analyze";
import type { BookContext } from "./types";
import {
  searchOpenLibrary,
  fetchOpenLibraryWork,
  buildCoverUrl,
  normalizeGenres,
  findEnglishCover,
  findIsbnCover,
  isJunkTitle,
  type OLSearchResult,
} from "@/lib/openlibrary";
import { isEnglishTitle } from "@/lib/queries/books";
import { findGoogleBooksCover } from "@/lib/google-books";
import { findAmazonCover } from "@/lib/amazon-covers";
import { sanitizeDescription, normalizeTitle as normalizeTitleSanitize, titleCaseGenre, truncateSummary } from "./sanitize";
import { verifyIdentity } from "./identity";
import { findDuplicateBook } from "./dedup";
import { fetchOLMetadata } from "./ol-metadata";
import { discoverAuthorBooks } from "./discover-author";
import { normalizePublicationDate } from "./sanitize";
import { findOrCreateAuthor } from "@/lib/actions/books";

export interface EnrichOptions {
  /** Skip Google Books API calls (use during bulk re-enrichment to avoid rate limits) */
  skipGoogleBooks?: boolean;
  /** Skip Brave Search API calls (use when Brave quota is exhausted) */
  skipBrave?: boolean;
  /** Run only a specific enrichment step instead of the full pipeline */
  focus?: "full" | "cover" | "audio" | "description";
}

export async function enrichBook(bookId: string, options?: EnrichOptions): Promise<void> {
  // Auto-pause: skip if API was exhausted in the last hour (resets at midnight PST)
  if (process.env.ENRICHMENT_PAUSED === "true") {
    console.log(`[enrichment] PAUSED — skipping ${bookId}`);
    return;
  }
  const recentExhaustion = await db.all(sql`
    SELECT count(*) as count FROM enrichment_log
    WHERE status = 'api_exhausted'
    AND created_at > datetime('now', '-1 hour')
  `) as { count: number }[];
  if ((recentExhaustion[0]?.count ?? 0) > 0) {
    console.log(`[enrichment] Auto-paused (API exhausted in last hour) — skipping ${bookId}`);
    return;
  }

  console.log(`[enrichment] Starting enrichment for book ${bookId}`);
  try {
    await _enrichBookInner(bookId, options);
    // Log success
    await db.insert(enrichmentLog).values({
      bookId,
      status: "success",
    }).onConflictDoNothing();
  } catch (err: unknown) {
    const code = (err as Error & { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    const status = code === "API_EXHAUSTED" ? "api_exhausted" : "failed";

    console.error(`[enrichment] ${status} for book ${bookId}: ${message}`);

    await db.insert(enrichmentLog).values({
      bookId,
      status,
      errorMessage: message,
    }).onConflictDoNothing();

    // Email admin about the failure
    try {
      const bookRow = await db.query.books.findFirst({
        where: eq(books.id, bookId),
        columns: { title: true },
      });
      const { sendEnrichmentFailureEmail } = await import("@/lib/email");
      await sendEnrichmentFailureEmail(
        bookRow?.title ?? bookId,
        bookId,
        message,
        status
      );
    } catch {
      // Don't let email failure prevent normal error flow
    }

    // Re-throw API_EXHAUSTED so callers (batch scripts) can stop the loop
    if (code === "API_EXHAUSTED") throw err;
  }
}

async function _enrichBookInner(bookId: string, options?: EnrichOptions): Promise<void> {
  const focus = options?.focus ?? "full";

  // 1. Fetch book with authors and genres
  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });
  if (!book) {
    console.error(`[enrichment] Book ${bookId} not found`);
    return;
  }

  // Skip and auto-delete non-English books — don't waste API calls
  const isNonEnglishLang = book.language && book.language !== "English" && book.language !== "";
  const isNonEnglishTitle = !isEnglishTitle(book.title);

  if (isNonEnglishLang || isNonEnglishTitle) {
    const reason = isNonEnglishLang ? `language: ${book.language}` : "non-English title detected";
    console.log(`[enrichment] Non-English book: "${book.title}" (${reason}) — marking import_only`);
    await db.update(books).set({
      visibility: "import_only",
      language: book.language || "non-English",
      updatedAt: new Date().toISOString(),
    }).where(eq(books.id, bookId));
    return;
  }

  // Box sets: resolve cover only, skip content analysis entirely
  if (book.isBoxSet) {
    console.log(`[enrichment] Box set detected: "${book.title}" — cover-only enrichment`);
    const authorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, bookId));
    if (!book.coverImageUrl || !book.coverVerified) {
      await resolveBookCover(book, authorRows.map((r) => r.name), options);
    }
    return;
  }

  // Auto-detect box sets by title keywords
  const BOX_SET_TITLE_PATTERNS = /\b(?:duology|trilogy|omnibus|box\s*set|boxed\s*set|collection|complete\s*series|volume\s*set|book\s*set|bundle|compilation|compendium)\b/i;
  if (!book.isBoxSet && BOX_SET_TITLE_PATTERNS.test(book.title)) {
    console.log(`[enrichment] Auto-detected box set: "${book.title}"`);
    await db.update(books).set({ isBoxSet: true, updatedAt: new Date().toISOString() }).where(eq(books.id, bookId));
    // Do cover-only enrichment for box sets
    const authorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, bookId));
    if (!book.coverImageUrl || !book.coverVerified) {
      await resolveBookCover(book, authorRows.map((r) => r.name), options);
    }
    return;
  }

  const bookAuthorRows = await db
    .select({ name: authors.name })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(eq(bookAuthors.bookId, bookId));

  const authorNames = bookAuthorRows.map((r) => r.name);

  // ── Phase 0: If no OL key, search OL by title to find one ──
  if (focus === "full" && !book.openLibraryKey) {
    try {
      const searchQ = encodeURIComponent(`${book.title} ${authorNames.join(" ")}`.trim());
      const olSearchUrl = `https://openlibrary.org/search.json?q=${searchQ}&limit=5`;
      const resp = await fetch(olSearchUrl);
      if (resp.ok) {
        const data = await resp.json();
        const docs = data.docs ?? [];
        // Find best match — require 2-of-3 identity signals (title + author, title + ISBN, or author + ISBN)
        for (const doc of docs) {
          const docAuthors: string[] = doc.author_name ?? [];
          const identity = verifyIdentity(
            { title: book.title, authors: authorNames, isbn13: book.isbn13, isbn10: book.isbn10 },
            { title: doc.title ?? "", authors: docAuthors, isbn: doc.isbn ?? [] }
          );
          if (identity.pass) {
            const workKey = doc.key; // e.g. "/works/OL12345W"
            if (workKey) {
              await db.update(books).set({ openLibraryKey: workKey, updatedAt: new Date().toISOString() }).where(eq(books.id, bookId));
              Object.assign(book, { openLibraryKey: workKey });
              console.log(`[enrichment] Found OL key via search: ${workKey} for "${book.title}"`);

              // Also grab author from OL if we don't have one
              if (authorNames.length === 0 && doc.author_name?.length > 0) {
                for (const aName of doc.author_name.slice(0, 2)) {
                  const authorId = await findOrCreateAuthor(aName);
                  await db.insert(bookAuthors).values({ bookId, authorId }).onConflictDoNothing();
                  authorNames.push(aName);
                  console.log(`[enrichment] Added author from OL search: ${aName}`);
                }
              }

              // Grab basic metadata from search result
              const olUpdates: Record<string, unknown> = {};
              if (!book.publicationYear && doc.first_publish_year) {
                // OL work-level first_publish_year is the original publication date — always trust it
                olUpdates.publicationYear = doc.first_publish_year;
              }
              if (!book.pages && doc.number_of_pages_median) olUpdates.pages = doc.number_of_pages_median;
              if (!book.isbn13 && doc.isbn?.length > 0) {
                const isbn13 = doc.isbn.find((i: string) => i.length === 13);
                if (isbn13) olUpdates.isbn13 = isbn13;
              }
              if (Object.keys(olUpdates).length > 0) {
                olUpdates.updatedAt = new Date().toISOString();
                await db.update(books).set(olUpdates).where(eq(books.id, bookId));
                Object.assign(book, olUpdates);
                console.log(`[enrichment] OL search metadata: ${Object.keys(olUpdates).filter(k => k !== 'updatedAt').join(', ')}`);
              }
            }
            break;
          }
        }
      }
    } catch (e) {
      console.warn(`[enrichment] OL search failed for "${book.title}":`, e);
    }
  }

  // ── Phase 1: OL Metadata (free) — fill gaps before spending on Brave/Grok ──
  if (focus === "full" && book.openLibraryKey) {
    const olMeta = await fetchOLMetadata(book.openLibraryKey, book.isbn13, book.isbn10);
    const olUpdates: Record<string, unknown> = {};

    if (!book.description && olMeta.description) olUpdates.description = olMeta.description;
    if (!book.pages && olMeta.pages) olUpdates.pages = olMeta.pages;
    if (!book.publicationYear && olMeta.publicationYear) olUpdates.publicationYear = olMeta.publicationYear;
    if (!book.publicationDate && olMeta.publicationDate) olUpdates.publicationDate = olMeta.publicationDate;
    if (!book.isbn13 && olMeta.isbn13) olUpdates.isbn13 = olMeta.isbn13;
    if (!book.isbn10 && olMeta.isbn10) olUpdates.isbn10 = olMeta.isbn10;
    if (!book.publisher && olMeta.publisher) olUpdates.publisher = olMeta.publisher;
    if (!book.coverImageUrl && olMeta.coverUrl) {
      olUpdates.coverImageUrl = olMeta.coverUrl;
      olUpdates.coverSource = 'openlibrary';
      olUpdates.coverVerified = true;
    }

    if (Object.keys(olUpdates).length > 0) {
      olUpdates.updatedAt = new Date().toISOString();
      await db.update(books).set(olUpdates).where(eq(books.id, bookId));
      // Update local reference so downstream code sees OL data
      Object.assign(book, olUpdates);
      console.log(`[enrichment] OL metadata filled: ${Object.keys(olUpdates).filter(k => k !== 'updatedAt').join(', ')}`);
    }

    // Link OL genres if book has none
    if (olMeta.genres && olMeta.genres.length > 0) {
      const existingGenreCount = await db.all(sql`
        SELECT COUNT(*) as count FROM book_genres WHERE book_id = ${bookId}
      `) as { count: number }[];

      if ((existingGenreCount[0]?.count ?? 0) === 0) {
        for (const gn of olMeta.genres.slice(0, 6)) {
          const genre = await db.query.genres.findFirst({
            where: eq(genres.name, gn),
            columns: { id: true },
          });
          if (genre) {
            await db.insert(bookGenres).values({ bookId, genreId: genre.id }).onConflictDoNothing();
          }
        }
      }
    }
  }

  // ── Cover-only mode: just resolve cover, skip everything else ──
  if (focus === "cover") {
    if (!book.coverImageUrl || !book.coverVerified) {
      await resolveBookCover(book, authorNames, options);
    }
    console.log(`[enrichment] Cover-only enrichment complete for "${book.title}"`);
    return;
  }

  // ── Audio-only mode: just search for audiobook length ──
  if (focus === "audio") {
    if (!book.audioLengthMinutes) {
      await searchAudiobookLength(bookId, book.title, authorNames);
    }
    console.log(`[enrichment] Audio-only enrichment complete for "${book.title}"`);
    return;
  }

  // ── Brave metadata search: fill author/pages/year/description if still missing ──
  const needsMetadata = !book.description || !book.pages || !book.publicationYear || authorNames.length === 0;
  if (focus === "full" && needsMetadata && !options?.skipBrave) {
    try {
      const metaQuery = book.asin
        ? `"${book.title}" ASIN ${book.asin} book author pages published`
        : `"${book.title}" ${authorNames.join(" ")} book author pages published site:goodreads.com OR site:amazon.com`;
      const metaResults = await braveSearch(metaQuery, 5);

      if (metaResults.length > 0) {
        const allText = metaResults.map(r => `${r.title} ${r.description}`).join(" ");
        const metaUpdates: Record<string, unknown> = {};

        // Extract author from search results
        if (authorNames.length === 0) {
          let foundAuthor: string | null = null;

          // Strategy 1: Amazon title format "Book Title: Author, Name: ISBN"
          for (const r of metaResults) {
            const amazonMatch = r.title.match(/:\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*:/);
            if (amazonMatch) { foundAuthor = amazonMatch[1].trim(); break; }
          }

          // Strategy 2: "series by Author" or "book by Author" at start of snippet
          if (!foundAuthor) {
            for (const r of metaResults) {
              const snippetMatch = r.description.match(/^(?:.*?)\bbook\s+(?:series\s+)?by\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)/);
              if (snippetMatch) { foundAuthor = snippetMatch[1].trim(); break; }
            }
          }

          // Strategy 3: Generic "by Author" but NOT "created by", "illustrated by", "narrated by", "universe by"
          if (!foundAuthor) {
            const SKIP_PREFIXES = /(?:created|illustrated|narrated|designed|edited|translated|universe|foreword|introduction|adapted)\s+by/i;
            for (const r of metaResults) {
              const parts = r.description.split(/\.\s+/);
              for (const part of parts) {
                if (SKIP_PREFIXES.test(part)) continue;
                const byMatch = part.match(/\bby\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
                if (byMatch) { foundAuthor = byMatch[1].trim(); break; }
              }
              if (foundAuthor) break;
            }
          }

          if (foundAuthor) {
            const authorId = await findOrCreateAuthor(foundAuthor);
            await db.insert(bookAuthors).values({ bookId, authorId }).onConflictDoNothing();
            authorNames.push(foundAuthor);
            console.log(`[enrichment] Added author from Brave: ${foundAuthor}`);
          }
        }

        // Extract page count
        if (!book.pages) {
          const pageMatch = allText.match(/(\d{2,4})\s*(?:pages|pp\.?|p\.)\b/i);
          if (pageMatch) {
            const pages = parseInt(pageMatch[1]);
            if (pages > 20 && pages < 5000) {
              metaUpdates.pages = pages;
            }
          }
        }

        // Extract year
        if (!book.publicationYear) {
          const yearMatch = allText.match(/(?:published|released|publication|pub(?:lished)?[\s:]+(?:date)?)\s*(?:in\s+)?(\d{4})/i)
            || allText.match(/(?:copyright|©)\s*(\d{4})/i);
          if (yearMatch) {
            const year = parseInt(yearMatch[1]);
            if (year >= 1900 && year <= new Date().getFullYear() + 1) {
              metaUpdates.publicationYear = year;
            }
          }
        }

        // Extract description from Amazon/Goodreads snippets
        if (!book.description) {
          const JUNK_DESC_PATTERNS = /\b(books\s*\|\s*\d+\s*friends|edit\s*data|browse\s*history|viewing\s*product\s*detail|sign\s*in\s*to|add\s*to\s*cart|buy\s*now|free\s*shipping|your\s*browsing\s*history|grew\s*up\s*exploring|currently\s*working\s*on\s*the\s*\w+\s*book|you\s*can\s*often\s*find\s*him|reside[sd]?\s*in)/i;
          for (const r of metaResults) {
            if (r.description.length > 100
                && !r.description.match(/^(Buy|Shop|Free shipping)/i)
                && !JUNK_DESC_PATTERNS.test(r.description)) {
              metaUpdates.description = r.description.slice(0, 500);
              break;
            }
          }
        }

        if (Object.keys(metaUpdates).length > 0) {
          metaUpdates.updatedAt = new Date().toISOString();
          await db.update(books).set(metaUpdates).where(eq(books.id, bookId));
          Object.assign(book, metaUpdates);
          console.log(`[enrichment] Brave metadata filled: ${Object.keys(metaUpdates).filter(k => k !== 'updatedAt').join(', ')}`);
        }
      }
    } catch (e) {
      console.warn(`[enrichment] Brave metadata search failed for "${book.title}":`, e);
    }
  }

  // ── Full or description mode: need genres and searches ──
  const bookGenreRows = await db
    .select({ name: genres.name })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(eq(bookGenres.bookId, bookId));

  const genreNames = bookGenreRows.map((r) => r.name);
  const searchName = `"${book.title}" ${authorNames.join(" ")}`;

  console.log(`[enrichment] Searching for: ${searchName}`);

  // 2. Run Brave searches in parallel for deeper research
  // Add a 5th search for description if book is missing one
  const searches: Promise<{ title: string; url: string; description: string }[]>[] = [
    braveSearch(`${searchName} content warnings trigger warnings`, 8),
    braveSearch(`${searchName} book review content themes`, 8),
    braveSearch(`${searchName} book series reading order synopsis Goodreads`, 6),
    braveSearch(`${searchName} parent guide mature content sexual violence`, 5),
  ];
  if (!book.description) {
    searches.push(
      braveSearch(`${searchName} "about this book" OR "book description" OR "editorial reviews" site:amazon.com OR site:goodreads.com`, 5)
    );
  }

  const searchResults = await Promise.all(searches);
  const [warningResults, reviewResults, detailResults, parentGuideResults] = searchResults;
  const descriptionResults = searchResults[4] ?? [];

  const allResults = [...warningResults, ...reviewResults, ...detailResults, ...parentGuideResults, ...descriptionResults];
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

  // Update summary — overwrite if empty, very short, or over the 190-char limit
  const summaryIsThin = !book.summary || book.summary.length < 80 || book.summary.length > 190;
  if (summaryIsThin && result.summary) {
    // Enforce 190-char limit (belt-and-suspenders with analyze.ts truncation)
    let finalSummary = result.summary;
    if (finalSummary.length > 190) {
      finalSummary = truncateSummary(finalSummary, 190);
      console.log(`[enrichment] Truncated summary from ${result.summary.length} → ${finalSummary.length} chars`);
    }
    // Detect low-confidence / garbage summaries
    const LOW_CONFIDENCE_PATTERNS = [
      /undisclosed premise/i,
      /undefined tone/i,
      /no\s+(available\s+)?description/i,
      /complete lack of/i,
      /insufficient\s+(data|information)/i,
      /cannot\s+be\s+determined/i,
      /no\s+specific\s+(details|information)\s+(found|available)/i,
    ];
    // Also reject summaries that are just copied from the description
    const isCopiedFromDesc = book.description &&
      finalSummary.length > 30 &&
      book.description.startsWith(finalSummary.slice(0, Math.min(finalSummary.length, 50)));

    const isLowConfidence = LOW_CONFIDENCE_PATTERNS.some((p) => p.test(finalSummary));
    if (isLowConfidence || isCopiedFromDesc) {
      if (isCopiedFromDesc) console.warn(`[enrichment] Summary is just description copy for "${book.title}" — rejecting`);
      console.warn(`[enrichment] Low-confidence summary for "${book.title}": "${finalSummary}"`);
      // Don't write the garbage summary — log as needs_review instead
      await db.insert(enrichmentLog).values({
        bookId,
        status: "needs_review",
        errorMessage: `Low-confidence summary: "${finalSummary}"`,
      }).onConflictDoNothing();
    } else {
      await db
        .update(books)
        .set({ summary: finalSummary, updatedAt: new Date().toISOString() })
        .where(eq(books.id, bookId));
      if (book.summary) {
        console.log(`[enrichment] Updated summary (was ${book.summary.length} chars, now ${finalSummary.length})`);
      }
    }
  }

  // Always set isFiction and language from analysis
  const updateFields: Record<string, unknown> = {
    isFiction: result.isFiction,
    updatedAt: new Date().toISOString(),
  };
  if (result.language) {
    updateFields.language = result.language;
  }
  await db
    .update(books)
    .set(updateFields)
    .where(eq(books.id, bookId));
  if (result.isFiction !== (book.isFiction ?? true)) {
    console.log(
      `[enrichment] Updated isFiction: ${book.isFiction} → ${result.isFiction}`
    );
  }
  if (result.language && result.language !== book.language) {
    console.log(
      `[enrichment] Set language: ${book.language ?? "null"} → ${result.language}`
    );
  }

  // Write publisher description if we found one and the book doesn't have one
  // Apply sanitization to strip HTML/links/URLs before storing
  if (!book.description && result.description) {
    const cleanDesc = sanitizeDescription(result.description);
    await db
      .update(books)
      .set({ description: cleanDesc, updatedAt: new Date().toISOString() })
      .where(eq(books.id, bookId));
    console.log(`[enrichment] Set publisher description (${cleanDesc.length} chars) for "${book.title}"`);
  }

  // If description-only mode, skip the rest (genres, ratings, series, audio, cover)
  if (focus === "description") {
    console.log(`[enrichment] Description-focus enrichment complete for "${book.title}"`);
    return;
  }

  // Add supplemental genre tags (skip bare Fiction/Nonfiction — tracked by isFiction)
  const SKIP_TAGS = new Set(["Fiction", "Nonfiction", "Non-Fiction"]);
  const TAG_NORMALIZE: Record<string, string> = {
    "Science Fiction": "Sci-Fi",
    "Sci-fi": "Sci-Fi",
    "science fiction": "Sci-Fi",
  };

  // Helper: find or create a genre, then link it to a book (idempotent)
  async function linkGenreToBook(tagName: string, targetBookId: string): Promise<void> {
    // Always title-case genre names to prevent lowercase duplicates
    const normalizedName = titleCaseGenre(tagName);
    let genre = await db.query.genres.findFirst({
      where: eq(genres.name, normalizedName),
    });
    if (!genre) {
      // Also check for the raw name in case it exists with different casing
      genre = await db.query.genres.findFirst({
        where: eq(genres.name, tagName),
      });
      if (genre) {
        // Rename existing genre to title-cased version
        await db.update(genres).set({ name: normalizedName }).where(eq(genres.id, genre.id));
      } else {
        const [created] = await db
          .insert(genres)
          .values({ name: normalizedName })
          .returning();
        genre = created;
      }
    }
    const existing = await db
      .select()
      .from(bookGenres)
      .where(and(eq(bookGenres.bookId, targetBookId), eq(bookGenres.genreId, genre.id)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(bookGenres).values({ bookId: targetBookId, genreId: genre.id });
    }
    // Also link parent genre if this genre has one
    if (genre.parentGenreId) {
      const parent = await db.query.genres.findFirst({
        where: eq(genres.id, genre.parentGenreId),
      });
      if (parent) {
        const parentLinked = await db
          .select()
          .from(bookGenres)
          .where(and(eq(bookGenres.bookId, targetBookId), eq(bookGenres.genreId, parent.id)))
          .limit(1);
        if (parentLinked.length === 0) {
          await db.insert(bookGenres).values({ bookId: targetBookId, genreId: parent.id });
          console.log(`[enrichment] Auto-linked parent tag: ${parent.name}`);
        }
      }
    }
  }

  const allBookTags = new Set(genreNames.map((g) => g.toLowerCase()));
  // Cap: max 3 new supplemental display tags (parents don't count toward this cap)
  const MAX_DISPLAY_TAGS = 6;
  let addedCount = 0;
  for (let tagName of result.supplementalTags) {
    if (addedCount >= 3) break;
    tagName = TAG_NORMALIZE[tagName] ?? tagName;
    if (SKIP_TAGS.has(tagName)) continue;
    const tagLower = tagName.toLowerCase();
    if (allBookTags.has(tagLower)) continue;

    await linkGenreToBook(tagName, bookId);
    console.log(`[enrichment] Added tag: ${tagName}`);
    addedCount++;
    allBookTags.add(tagLower);
  }

  // Enforce display tag cap of 6 — only count tags that would be visible
  // (a tag is "hidden" if it's a parent and one of its children is also linked)
  const currentTags = await db
    .select({
      genreId: bookGenres.genreId,
      name: genres.name,
      parentGenreId: genres.parentGenreId,
    })
    .from(bookGenres)
    .innerJoin(genres, eq(bookGenres.genreId, genres.id))
    .where(eq(bookGenres.bookId, bookId));

  const linkedIds = new Set(currentTags.map((t) => t.genreId));
  const displayTags = currentTags.filter((t) => {
    // Hide this tag if it's a parent and any of its children are also linked
    const hasLinkedChild = currentTags.some(
      (other) => other.parentGenreId === t.genreId && linkedIds.has(other.genreId)
    );
    return !hasLinkedChild;
  });

  if (displayTags.length > MAX_DISPLAY_TAGS) {
    // Trim least useful display tags (prefer shorter/known names)
    const scored = displayTags.map((t) => ({
      ...t,
      score: t.name.length <= 20 ? 5 : 1,
    }));
    scored.sort((a, b) => b.score - a.score);
    const toRemove = scored.slice(MAX_DISPLAY_TAGS);
    for (const tag of toRemove) {
      await db
        .delete(bookGenres)
        .where(
          and(eq(bookGenres.bookId, bookId), eq(bookGenres.genreId, tag.genreId))
        );
      console.log(`[enrichment] Trimmed excess tag: ${tag.name}`);
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

  // 5. Handle series info with fuzzy name matching to prevent duplicates
  if (result.series?.name) {
    // Check if this book already has a series assignment
    const existingSeriesLink = await db
      .select()
      .from(bookSeries)
      .where(eq(bookSeries.bookId, bookId))
      .limit(1);

    if (existingSeriesLink.length === 0) {
      // Fuzzy match: normalize series name for comparison
      const normalizedName = normalizeSeries(result.series.name);

      // Get all existing series and find best match
      const allSeries = await db.select().from(series);
      let seriesRow = allSeries.find(
        (s) => normalizeSeries(s.name) === normalizedName
      );

      if (!seriesRow) {
        // No fuzzy match — create new
        const [created] = await db
          .insert(series)
          .values({ name: result.series.name })
          .returning();
        seriesRow = created;
      }

      // Link book to series
      await db.insert(bookSeries).values({
        bookId,
        seriesId: seriesRow.id,
        positionInSeries: result.series.position,
      });
      console.log(
        `[enrichment] Added to series: ${seriesRow.name} #${result.series.position ?? "?"}`
      );

      // Discover and import other books in this series from Open Library
      try {
        await discoverSeriesBooks(seriesRow.id, seriesRow.name, authorNames);
      } catch (err) {
        console.error(`[enrichment] Series discovery error:`, err);
      }
    }
  }

  // ── Author bibliography discovery ──
  // If this is the first book by any of this book's authors, discover their other works
  for (const authorRow of bookAuthorRows) {
    const authorRecord = await db.query.authors.findFirst({
      where: eq(authors.name, authorRow.name),
      columns: { id: true, openLibraryKey: true },
    });
    if (authorRecord) {
      try {
        await discoverAuthorBooks(authorRecord.id, authorRow.name, authorRecord.openLibraryKey);
      } catch (err) {
        console.error(`[enrichment] Author discovery failed for "${authorRow.name}":`, err);
      }
    }
  }

  // 6. Look up audiobook length if not already set
  if (!book.audioLengthMinutes) {
    await searchAudiobookLength(bookId, book.title, authorNames);
  }

  // 7. Resolve cover if missing or not yet verified — multi-tier cascade
  // NEVER overwrite manually-set covers (cover_source = 'manual' or Amazon URLs)
  const isManualCover = book.coverSource === 'manual' ||
    (book.coverImageUrl && book.coverImageUrl.includes('m.media-amazon.com'));
  if ((!book.coverImageUrl || !book.coverVerified) && !isManualCover) {
    await resolveBookCover(book, authorNames, options);
  }

  // ── Final check: flag incomplete books for manual review ──
  const finalBook = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  const finalAuthors = await db.select().from(bookAuthors).where(eq(bookAuthors.bookId, bookId));
  const missing: string[] = [];
  if (!finalBook?.description) missing.push("description");
  if (!finalBook?.pages) missing.push("pages");
  if (!finalBook?.publicationYear) missing.push("year");
  if (!finalBook?.coverImageUrl) missing.push("cover");
  if (finalAuthors.length === 0) missing.push("author");
  if (!finalBook?.publisher) missing.push("publisher");
  // Check genres
  const finalGenreCount = await db.select({ count: sql`COUNT(*)` }).from(bookGenres).where(eq(bookGenres.bookId, bookId));
  if ((finalGenreCount[0]?.count ?? 0) === 0) missing.push("genres");

  // Auto-flag if missing author (regardless of other fields) or 2+ missing fields
  const needsFlag = missing.includes("author") || missing.length >= 2;
  if (needsFlag) {
    await db.update(books).set({
      needsReview: true,
      reviewReason: `missing: ${missing.join(", ")}`,
    }).where(eq(books.id, bookId));
    console.log(`[enrichment] Flagged for review: ${missing.join(", ")}`);
  }

  console.log(`[enrichment] Enrichment complete for "${book.title}"`);
}

/**
 * Multi-tier cover resolution cascade.
 * Tier A: OL ISBN cover (free, instant HEAD check)
 * Tier B: OL edition cover re-check (free, paginated API)
 * Tier C: Brave Search for cover on Amazon/Goodreads
 * Tier D: Google Books (non-bulk only)
 * Tier E: Amazon CDN direct (ASIN from books.asin or links table)
 */
async function resolveBookCover(
  book: { id: string; title: string; isbn13: string | null; isbn10: string | null; openLibraryKey: string | null; asin: string | null },
  authorNames: string[],
  options?: EnrichOptions
): Promise<void> {
  let coverUrl: string | null = null;

  // Tier A: OL English edition cover (language-aware, most reliable)
  if (book.openLibraryKey) {
    try {
      const { coverId } = await findEnglishCover(book.openLibraryKey);
      if (coverId) {
        coverUrl = buildCoverUrl(coverId, "L");
        if (coverUrl) console.log(`[enrichment] Cover found via OL English edition for "${book.title}"`);
      }
    } catch {
      // OL API error — continue to next tier
    }
  }

  // Tier B: OL ISBN cover (fallback — may not be English edition but usually correct)
  if (!coverUrl && book.isbn13) {
    coverUrl = await findIsbnCover(book.isbn13);
    if (coverUrl) console.log(`[enrichment] Cover found via ISBN-13 for "${book.title}"`);
  }
  if (!coverUrl && book.isbn10) {
    coverUrl = await findIsbnCover(book.isbn10);
    if (coverUrl) console.log(`[enrichment] Cover found via ISBN-10 for "${book.title}"`);
  }

  // Tier C: Brave Search for cover
  if (!coverUrl) {
    try {
      const searchName = `"${book.title}" "${authorNames[0] ?? ""}"`;
      const coverResults = await braveSearch(`${searchName} book cover`, 5);
      // Look for direct image URLs in search result descriptions from known book sites
      for (const result of coverResults) {
        const imgMatch = result.description.match(/(https?:\/\/[^\s"<>]+\.(?:jpg|jpeg|png))/i);
        if (imgMatch) {
          const url = imgMatch[1];
          // Only accept image URLs from trusted book cover sources
          if (url.includes("m.media-amazon.com") || url.includes("images-na.ssl-images-amazon.com") ||
              url.includes("i.gr-assets.com") || url.includes("covers.openlibrary.org") ||
              url.includes("books.google.com") || url.includes("bookshop.org")) {
            // Validate the image actually exists with a HEAD request
            try {
              const headRes = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
              if (headRes.ok) {
                coverUrl = url;
                console.log(`[enrichment] Cover found via Brave search for "${book.title}"`);
                break;
              }
            } catch { /* skip invalid URLs */ }
          }
        }
      }
    } catch (err) {
      console.warn(`[enrichment] Brave cover search failed:`, err);
    }
  }

  // Tier D: Google Books (non-bulk only)
  if (!coverUrl && !options?.skipGoogleBooks) {
    try {
      coverUrl = await findGoogleBooksCover({
        title: book.title,
        authors: authorNames,
        isbn13: book.isbn13,
        isbn10: book.isbn10,
        asin: book.asin,
      });
      if (coverUrl) console.log(`[enrichment] Cover found via Google Books for "${book.title}"`);
    } catch (err) {
      console.warn(`[enrichment] Google Books cover lookup failed:`, err);
    }
  }

  // Tier E: Amazon CDN direct (ASIN from books.asin or links table)
  if (!coverUrl) {
    try {
      // Fetch any Amazon links stored for this book
      const amazonLinks = await db
        .select({ url: links.url })
        .from(links)
        .where(and(eq(links.bookId, book.id), eq(links.type, "amazon")));

      const amazonLinkUrls = amazonLinks.map((l) => l.url);

      coverUrl = await findAmazonCover({
        asin: book.asin,
        amazonLinkUrls,
      });
      if (coverUrl) console.log(`[enrichment] Cover found via Amazon CDN for "${book.title}"`);
    } catch (err) {
      console.warn(`[enrichment] Amazon cover lookup failed:`, err);
    }
  }

  if (coverUrl) {
    const source = detectCoverSource(coverUrl);
    await db
      .update(books)
      .set({
        coverImageUrl: coverUrl,
        coverVerified: true,
        coverSource: source,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(books.id, book.id));
  } else {
    console.log(`[enrichment] No cover found across all tiers for "${book.title}"`);
  }
}

/** Detect cover source from URL pattern. */
function detectCoverSource(url: string): string {
  if (url.includes("covers.openlibrary.org")) return "openlibrary";
  if (url.includes("books.google.com")) return "google_books";
  if (url.includes("m.media-amazon.com") || url.includes("images-na.ssl-images-amazon.com")) return "amazon";
  if (url.includes("i.gr-assets.com")) return "brave";
  if (url.startsWith("/uploads/")) return "manual";
  return "brave";
}

/**
 * Search for audiobook length using Audible-focused queries.
 * Runs two parallel Brave searches and parses duration from results.
 */
async function searchAudiobookLength(bookId: string, title: string, authorNames: string[]): Promise<void> {
  try {
    const author = authorNames[0] ?? "";
    const [results1, results2] = await Promise.all([
      braveSearch(`"${title}" "${author}" audible audiobook length`, 5),
      braveSearch(`"${title}" "${author}" audible listening length hours minutes`, 5),
    ]);

    const allAudioResults = [...results1, ...results2];
    const audioMinutes = parseAudiobookLength(allAudioResults);
    if (audioMinutes) {
      await db
        .update(books)
        .set({
          audioLengthMinutes: audioMinutes,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(books.id, bookId));
      console.log(
        `[enrichment] Set audiobook length: ${Math.floor(audioMinutes / 60)}h ${audioMinutes % 60}m`
      );
    } else {
      console.log(`[enrichment] No audiobook length found for "${title}"`);
    }
  } catch (err) {
    console.warn(`[enrichment] Audiobook length lookup failed:`, err);
  }
}

/**
 * Discover and import other books in a series from Open Library.
 * Searches OL for the series name, imports books that aren't already in the DB,
 * and links them to the series with correct positions.
 */
/** Titles matching these patterns are box sets / collections / non-book editions */
const BOX_SET_PATTERNS = [
  /\bbox\s*set\b/i,
  /\bboxed\s*set\b/i,
  /\bcollection\s+(set|of)\b/i,
  /\bseries\s+collection\b/i,
  /\bcomplete\s+collection\b/i,
  /\bsaga\s+collection\b/i,
  /\b(books?\s+\d+\s*[-–—]\s*\d+)\b/i, // "Books 1-3"
  /\b(volumes?\s+\d+\s*[-–—]\s*\d+)\b/i, // "Volumes 1-3"
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
  /\bbind[\s-]*up\b/i,
  /^novels?\s*\(/i,
  /\bvolume\s+\d+\s*$/i,
  /\billustrated\s+edition\b/i,
  /\bnº\s*\d+/i,
  /\btomo\s+/i,
];

function isBoxSet(title: string): boolean {
  return BOX_SET_PATTERNS.some((p) => p.test(title));
}

/**
 * Normalize a book title for fuzzy dedup.
 * Strips subtitles, articles, punctuation, series numbering, and lowercases.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:;]\s*.*/g, "") // strip subtitles after colon/semicolon
    .replace(/\(.*?\)/g, "") // strip parenthetical
    .replace(/^(the|a|an|la|le|les|el|los|las|die|der|das)\s+/i, "")
    .replace(/[''"`\-–—,!?.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch a list of expected book titles in a series via Brave search.
 * Returns normalized titles as a Set for fuzzy matching.
 */
async function fetchSeriesBookList(seriesName: string, authorName: string): Promise<Set<string>> {
  const results = await braveSearch(
    `"${seriesName}" series complete book list ${authorName}`,
    8
  );

  if (results.length === 0) return new Set();

  const allText = results.map((r) => `${r.title} ${r.description}`).join("\n");
  const titles = new Set<string>();

  // Pattern 1: Numbered items like "1. Title", "#1 Title", "Book 1: Title"
  const numberedRegex = /(?:^|\n)\s*(?:#?\d+[.):]\s*|Book\s+\d+[.:]\s*)([\w'][\w\s''&,:!?-]{2,50})/gi;
  let match;
  while ((match = numberedRegex.exec(allText)) !== null) {
    const title = match[1].trim().replace(/\s+/g, " ");
    if (title.length > 3) {
      titles.add(normalizeTitle(title));
    }
  }

  // Pattern 2: Title-case phrases after common series-list indicators
  const indicatorRegex = /(?:includes?|featuring|contains|followed by|books?:)\s*([\w'][\w\s''&,:!?-]{3,60})/gi;
  while ((match = indicatorRegex.exec(allText)) !== null) {
    const title = match[1].trim().replace(/\s+/g, " ");
    if (title.length > 3) {
      titles.add(normalizeTitle(title));
    }
  }

  return titles;
}

/**
 * Check if a candidate title fuzzy-matches any title in the allowlist.
 * Uses normalized substring matching — if any word sequence from the candidate
 * appears in an allowlist entry (or vice versa), it's a match.
 */
function matchesAllowlist(candidateTitle: string, allowlist: Set<string>): boolean {
  const normCandidate = normalizeTitle(candidateTitle);
  for (const allowed of allowlist) {
    if (normCandidate === allowed) return true;
    if (normCandidate.includes(allowed) || allowed.includes(normCandidate)) return true;
    // Check if significant words overlap (at least 2 words in common)
    const candidateWords = normCandidate.split(/\s+/).filter((w) => w.length > 2);
    const allowedWords = allowed.split(/\s+/).filter((w) => w.length > 2);
    const overlap = candidateWords.filter((w) => allowedWords.includes(w)).length;
    if (overlap >= 2 || (overlap >= 1 && candidateWords.length <= 2)) return true;
  }
  return false;
}

export async function discoverSeriesBooks(
  seriesId: string,
  seriesName: string,
  knownAuthors: string[]
): Promise<void> {
  console.log(`[series-discovery] Searching for books in series: "${seriesName}"`);

  // Step 1: Brave cross-reference — get expected book list for validation
  const braveAllowlist = await fetchSeriesBookList(seriesName, knownAuthors[0] ?? "");
  const useBraveFilter = braveAllowlist.size >= 3;
  if (useBraveFilter) {
    console.log(`[series-discovery] Brave allowlist (${braveAllowlist.size} titles): ${[...braveAllowlist].join(", ")}`);
  } else {
    console.log(`[series-discovery] Brave allowlist too small (${braveAllowlist.size}), skipping cross-ref filter`);
  }

  // Step 2: Search Open Library for the series
  const query = `${seriesName} ${knownAuthors[0] ?? ""}`.trim();
  const searchResults = await searchOpenLibrary(query, 30);

  if (searchResults.length === 0) {
    console.log(`[series-discovery] No OL results for "${seriesName}" — trying Brave fallback`);

    // Brave fallback: use the allowlist titles to create books via Google Books
    if (braveAllowlist.size >= 2) {
      const existingSeriesBooks = await db
        .select({ title: books.title })
        .from(bookSeries)
        .innerJoin(books, eq(bookSeries.bookId, books.id))
        .where(eq(bookSeries.seriesId, seriesId));
      const existingTitles = new Set(existingSeriesBooks.map(b => b.title.toLowerCase().replace(/[^a-z0-9]/g, "")));

      let braveImported = 0;
      for (const braveTitle of braveAllowlist) {
        const normBrave = braveTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (existingTitles.has(normBrave)) continue;

        // Search Google Books for cover + metadata
        try {
          const gbQuery = `${braveTitle} ${knownAuthors[0] ?? ""}`;
          const gbResp = await fetch(
            `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(gbQuery)}&maxResults=3&key=${process.env.GOOGLE_BOOKS_API_KEY}`
          );
          if (!gbResp.ok) continue;
          const gbData = await gbResp.json();
          const gbItem = gbData.items?.[0];
          if (!gbItem) continue;

          const vol = gbItem.volumeInfo;
          const coverUrl = vol.imageLinks?.thumbnail?.replace("http://", "https://") ?? null;
          const year = vol.publishedDate ? parseInt(vol.publishedDate.slice(0, 4)) : null;
          const pages = vol.pageCount || null;

          const [newBook] = await db.insert(books).values({
            title: braveTitle,
            publicationYear: year,
            pages,
            coverImageUrl: coverUrl,
            isFiction: true,
            language: "English",
          }).returning();

          // Link author
          if (knownAuthors[0]) {
            const authorId = await findOrCreateAuthor(knownAuthors[0]);
            await db.insert(bookAuthors).values({ bookId: newBook.id, authorId }).onConflictDoNothing();
          }

          // Link to series (no position — we don't know it from Brave)
          await db.insert(bookSeries).values({
            bookId: newBook.id,
            seriesId,
          }).onConflictDoNothing();

          // Generate SEO slug
          const { assignBookSlug } = await import("@/lib/utils/slugify");
          await assignBookSlug(newBook.id, braveTitle, knownAuthors[0] ?? "");

          console.log(`[series-discovery] Imported "${braveTitle}" via Brave+GBooks fallback`);

          // Enrich the new book via separate serverless invocation
          triggerEnrichment(newBook.id);

          braveImported++;
          if (braveImported >= 10) break;
        } catch (err) {
          console.warn(`[series-discovery] Brave fallback failed for "${braveTitle}":`, err);
        }
      }
      console.log(`[series-discovery] Brave fallback imported ${braveImported} books for "${seriesName}"`);
    }
    return;
  }

  // Track already-seen normalized titles to avoid importing foreign editions
  const seenTitles = new Set<string>();

  // Pre-populate with books already in this series
  const existingSeriesBooks = await db
    .select({ title: books.title })
    .from(bookSeries)
    .innerJoin(books, eq(bookSeries.bookId, books.id))
    .where(eq(bookSeries.seriesId, seriesId));
  for (const eb of existingSeriesBooks) {
    seenTitles.add(normalizeTitle(eb.title));
  }

  let imported = 0;

  for (const result of searchResults) {
    // Gate 1: Skip box sets and collections
    if (isBoxSet(result.title)) {
      console.log(`[series-discovery] Skipping box set: "${result.title}"`);
      continue;
    }

    // Gate 2: Skip junk titles (summaries, study guides, etc.)
    if (isJunkTitle(result.title)) {
      console.log(`[series-discovery] Skipping junk title: "${result.title}"`);
      continue;
    }

    // Gate 3: Skip non-English titles — check the ACTUAL title, not the English alias
    const candidateTitle = result.englishTitle ?? result.title;
    if (!isEnglishTitle(result.title)) {
      console.log(`[series-discovery] Skipping non-English title: "${result.title}"`);
      continue;
    }

    // Gate 4: Skip if a book with a very similar normalized title was already seen/imported
    const normTitle = normalizeTitle(result.title);
    const normEngTitle = result.englishTitle ? normalizeTitle(result.englishTitle) : null;
    if (seenTitles.has(normTitle) || (normEngTitle && seenTitles.has(normEngTitle))) {
      console.log(`[series-discovery] Skipping duplicate title: "${result.title}"`);
      continue;
    }

    // Skip if already imported by OL key
    const existing = await db.query.books.findFirst({
      where: eq(books.openLibraryKey, result.key),
    });

    if (existing) {
      seenTitles.add(normalizeTitle(existing.title));

      // Check if already linked to this series
      const existingLink = await db
        .select()
        .from(bookSeries)
        .where(
          and(
            eq(bookSeries.bookId, existing.id),
            eq(bookSeries.seriesId, seriesId)
          )
        )
        .limit(1);

      if (existingLink.length === 0) {
        // Link existing book to series if it shares an author
        const existingAuthors = await db
          .select({ name: authors.name })
          .from(bookAuthors)
          .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
          .where(eq(bookAuthors.bookId, existing.id));

        const shareAuthor = existingAuthors.some((a) =>
          knownAuthors.some(
            (ka) => ka.toLowerCase() === a.name.toLowerCase()
          )
        );

        if (shareAuthor) {
          await db.insert(bookSeries).values({
            bookId: existing.id,
            seriesId,
            positionInSeries: null, // Will be filled by enrichment
          }).onConflictDoNothing();
          console.log(`[series-discovery] Linked existing book "${existing.title}" to series`);
        }
      }
      continue;
    }

    // Gate 5: Check if the result shares an author with the series
    const resultAuthors = result.author_name ?? [];
    const sharesAuthor = resultAuthors.some((ra) =>
      knownAuthors.some((ka) => ka.toLowerCase() === ra.toLowerCase())
    );
    if (!sharesAuthor) continue;

    // Gate 6: Brave cross-reference — skip if not in the expected book list
    if (useBraveFilter && !matchesAllowlist(candidateTitle, braveAllowlist)) {
      console.log(`[series-discovery] Skipping "${candidateTitle}" — not found in Brave series list`);
      continue;
    }

    // Mark this title as seen before importing (both canonical and English)
    seenTitles.add(normTitle);
    if (normEngTitle) seenTitles.add(normEngTitle);

    // Import this book
    try {
      await delay(400); // Rate limit OL API
      const work = await fetchOpenLibraryWork(result.key);
      const { coverId: englishCoverId } = await findEnglishCover(result.key);
      const coverUrl =
        buildCoverUrl(englishCoverId, "L") ??
        buildCoverUrl(work.coverId, "L") ??
        buildCoverUrl(result.cover_i, "L");

      // Gate 7: Minimum quality — need at least a cover or a publication year
      const pubYear = result.first_publish_year ?? null;
      if (!coverUrl && !pubYear) {
        console.log(`[series-discovery] Skipping "${candidateTitle}" — no cover or year`);
        continue;
      }

      const genreNames = normalizeGenres(work.subjects);

      const NONFICTION_GENRES = new Set([
        "Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime", "Philosophy",
      ]);
      const isFiction = !genreNames.some((g) => NONFICTION_GENRES.has(g));

      // Gate 8: Re-check language on the actual work title from OL
      const rawWorkTitle = work.title || candidateTitle;
      if (!isEnglishTitle(rawWorkTitle)) {
        console.log(`[series-discovery] Skipping "${rawWorkTitle}" — work title is non-English`);
        continue;
      }

      // Prefer work title from OL over candidate title (may be edition-level)
      // Apply title normalization and description sanitization at import time
      const bookTitle = normalizeTitleSanitize(rawWorkTitle);
      const cleanDesc = work.description ? sanitizeDescription(work.description) : null;

      const [newBook] = await db
        .insert(books)
        .values({
          title: bookTitle,
          description: cleanDesc,
          publicationYear: pubYear,
          isbn13: result.isbn?.find((i) => i.length === 13) ?? null,
          isbn10: result.isbn?.find((i) => i.length === 10) ?? null,
          pages: result.number_of_pages_median,
          coverImageUrl: coverUrl,
          openLibraryKey: result.key,
          isFiction,
          isBoxSet: isBoxSet(bookTitle),
        })
        .returning();

      // Link authors
      for (let i = 0; i < resultAuthors.length; i++) {
        const name = resultAuthors[i];
        const olKey = result.author_key?.[i];
        let author = await db.query.authors.findFirst({
          where: eq(authors.name, name),
        });
        if (!author) {
          [author] = await db
            .insert(authors)
            .values({ name, openLibraryKey: olKey ?? null })
            .returning();
        }
        await db
          .insert(bookAuthors)
          .values({ bookId: newBook.id, authorId: author.id })
          .onConflictDoNothing();
      }

      // Link genres (and auto-link parent genres for stats rollup)
      for (const rawGenreName of genreNames) {
        const genreName = titleCaseGenre(rawGenreName);
        let genre = await db.query.genres.findFirst({
          where: eq(genres.name, genreName),
        });
        if (!genre) {
          [genre] = await db.insert(genres).values({ name: genreName }).returning();
        }
        await db
          .insert(bookGenres)
          .values({ bookId: newBook.id, genreId: genre.id })
          .onConflictDoNothing();
        // Auto-link parent genre if present
        if (genre.parentGenreId) {
          await db
            .insert(bookGenres)
            .values({ bookId: newBook.id, genreId: genre.parentGenreId })
            .onConflictDoNothing();
        }
      }

      // Link to series
      await db.insert(bookSeries).values({
        bookId: newBook.id,
        seriesId,
        positionInSeries: null, // Enrichment will fill this
      });

      // Generate SEO slug
      const { assignBookSlug } = await import("@/lib/utils/slugify");
      await assignBookSlug(newBook.id, bookTitle, resultAuthors[0] ?? "");

      imported++;
      console.log(`[series-discovery] Imported "${candidateTitle}" into series "${seriesName}"`);

      // Enrich the new book via separate serverless invocation
      triggerEnrichment(newBook.id);

      // Don't go overboard — max 15 books per series discovery
      if (imported >= 15) break;
    } catch (err) {
      console.warn(`[series-discovery] Failed to import "${result.title}":`, err);
    }
  }

  console.log(`[series-discovery] Discovered and imported ${imported} new books for "${seriesName}"`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse audiobook duration from search result snippets.
 * Looks for patterns like "12 hours and 30 minutes", "12h 30m", "12 hrs 30 mins", etc.
 */
function parseAudiobookLength(results: { title: string; url: string; description: string }[]): number | null {
  const combined = results.map((r) => `${r.title} ${r.description}`).join(" ");

  // Pattern 1: "X hours and Y minutes" / "X hours, Y minutes" / "X hrs Y mins"
  const hoursMinutesRegex = /(\d{1,3})\s*(?:hours?|hrs?|h)\s*(?:and\s*|,?\s*)(\d{1,2})\s*(?:minutes?|mins?|m)/gi;
  let match = hoursMinutesRegex.exec(combined);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 0 && hours < 100 && minutes >= 0 && minutes < 60) {
      return hours * 60 + minutes;
    }
  }

  // Pattern 2: "X hours" (no minutes)
  const hoursOnlyRegex = /(\d{1,3})\s*(?:hours?|hrs?|h)\b(?!\s*(?:and\s*)?\d)/gi;
  match = hoursOnlyRegex.exec(combined);
  if (match) {
    const hours = parseInt(match[1], 10);
    if (hours > 0 && hours < 100) {
      return hours * 60;
    }
  }

  // Pattern 3: "Listening Length: X hrs and Y mins" (Audible-style)
  const audibleRegex = /(?:listening\s+length|length|duration)[:\s]*(\d{1,3})\s*(?:hours?|hrs?|h)\s*(?:and\s*|,?\s*)(\d{1,2})\s*(?:minutes?|mins?|m)/gi;
  match = audibleRegex.exec(combined);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 0 && hours < 100 && minutes >= 0 && minutes < 60) {
      return hours * 60 + minutes;
    }
  }

  return null;
}

/**
 * Normalize a series name for fuzzy matching.
 * Strips "The", articles, punctuation, and lowercases.
 * "The Stormlight Archive" → "stormlight archive"
 * "Night Angel Trilogy" → "night angel trilogy"
 */
function normalizeSeries(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(the|a|an|la|le|les|el|los|las|die|der|das)\s+/i, "")
    .replace(/[''"`\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
