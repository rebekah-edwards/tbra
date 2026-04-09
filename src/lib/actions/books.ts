"use server";

import { db } from "@/db";
import { books, authors, bookAuthors, narrators, bookNarrators, genres, bookGenres, blockedOlKeys } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { validateBookTitle } from "@/lib/book-validation";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  fetchOpenLibraryWork,
  fetchAuthorWorks,
  buildCoverUrl,
  normalizeGenres,
  findEnglishCover,
  findEnglishEditionTitle,
  isJunkTitle,
  type OLSearchResult,
} from "@/lib/openlibrary";
import { isEnglishTitle, isBoxSetTitle } from "@/lib/queries/books";
import { triggerEnrichment } from "@/lib/enrichment/trigger";
import { after } from "next/server";
import {
  sanitizeDescription,
  normalizeTitle as normalizeTitleSanitize,
  titleCaseGenre,
} from "@/lib/enrichment/sanitize";
import { assignBookSlug } from "@/lib/utils/slugify";

const NONFICTION_GENRES = new Set([
  "Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime", "Philosophy",
]);

function detectIsFiction(genreNames: string[]): boolean {
  return !genreNames.some((g) => NONFICTION_GENRES.has(g));
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findOrCreateAuthor(
  name: string,
  olKey?: string
): Promise<string> {
  let author = await db.query.authors.findFirst({
    where: eq(authors.name, name),
  });
  if (author) {
    // Update OL key if we have one and author doesn't
    if (olKey && !author.openLibraryKey) {
      await db
        .update(authors)
        .set({ openLibraryKey: olKey })
        .where(eq(authors.id, author.id));
    }
    return author.id;
  }
  const [created] = await db
    .insert(authors)
    .values({ name, openLibraryKey: olKey ?? null })
    .returning();
  return created.id;
}

/**
 * Normalize a title for fuzzy duplicate matching.
 * Strips articles, subtitles, edition markers, author-in-title, punctuation,
 * and lowercases — so "Jane Eyre : (Charlotte Bronte Classics Collection)"
 * matches "Jane Eyre".
 */
function normalizeTitleForDedup(title: string): string {
  let t = title;
  // Remove everything after common separators that introduce edition/subtitle junk
  t = t.replace(/\s*[:\-–—([\/{]\s*.*$/, "");
  // Remove "by Author Name" suffix
  t = t.replace(/\s+by\s+.+$/i, "");
  // Remove known edition markers anywhere
  t = t.replace(/\b(paperback|hardcover|kindle|edition|large print|spanish|special|unabridged|abridged|annotated|illustrated|classic|global|dyslexia[- ]friendly)\b/gi, "");
  // Strip leading articles
  t = t.replace(/^(the|a|an)\s+/i, "");
  // Collapse to lowercase alphanumeric
  return t.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Check if a book with a matching normalized title + author already exists locally.
 * Returns the existing book ID if found, null otherwise.
 * This catches OL works with different keys that are actually the same book.
 */
async function findExistingByTitleAndAuthor(
  title: string,
  authorName: string | null
): Promise<string | null> {
  const normalized = normalizeTitleForDedup(title);
  if (!normalized) return null;

  // Get all candidate books — we'll filter by normalized title match
  // Using SQL LIKE with a generous pattern, then filter precisely in JS
  const shortTitle = title.replace(/\s*[:\-–—([\/{]\s*.*$/, "").trim();
  if (shortTitle.length < 3) return null;

  const candidates = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(sql`LOWER(${books.title}) LIKE ${`%${shortTitle.toLowerCase().slice(0, 30)}%`}`)
    .limit(20)
    .all();

  for (const candidate of candidates) {
    if (normalizeTitleForDedup(candidate.title) === normalized) {
      // If we have an author name, verify it matches too
      if (authorName) {
        const candidateAuthors = await db
          .select({ name: authors.name })
          .from(bookAuthors)
          .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
          .where(eq(bookAuthors.bookId, candidate.id))
          .all();

        const authorNorm = authorName.toLowerCase().replace(/[^a-z]/g, "");
        const hasMatchingAuthor = candidateAuthors.some(
          (a) => a.name.toLowerCase().replace(/[^a-z]/g, "") === authorNorm
        );
        if (!hasMatchingAuthor) continue;
      }
      return candidate.id;
    }
  }

  return null;
}

async function importCascadeBooks(authorOlKeys: string[]) {
  for (const authorKey of authorOlKeys) {
    await delay(350);
    const works = await fetchAuthorWorks(authorKey);

    // Load existing books by this author for fuzzy dedup
    const author = await db.query.authors.findFirst({
      where: eq(authors.openLibraryKey, authorKey),
    });
    const existingTitles = new Set<string>();
    if (author) {
      const authorBooks = await db
        .select({ title: books.title })
        .from(bookAuthors)
        .innerJoin(books, eq(books.id, bookAuthors.bookId))
        .where(eq(bookAuthors.authorId, author.id))
        .all();
      for (const ab of authorBooks) {
        existingTitles.add(normalizeTitleForDedup(ab.title));
      }
    }

    for (const work of works) {
      // Skip if already imported by OL key
      const workKey = work.key; // e.g. "/works/OL12345W"
      const existing = await db.query.books.findFirst({
        where: eq(books.openLibraryKey, workKey),
      });
      if (existing) continue;

      // Gate: Skip junk titles (coloring books, box sets, study guides, etc.)
      if (isJunkTitle(work.title)) {
        console.log(`[cascade-import] Skipping junk: "${work.title}"`);
        continue;
      }

      // Gate: Skip non-English titles
      if (!isEnglishTitle(work.title)) {
        console.log(`[cascade-import] Skipping non-English: "${work.title}"`);
        continue;
      }

      // Import with English-filtered cover (falls back to work cover if no English edition found)
      const { coverId: engCoverId } = await findEnglishCover(workKey);
      const coverUrl = buildCoverUrl(engCoverId, "L") ?? buildCoverUrl(work.covers?.[0], "L");

      // Resolve English title for foreign-language works
      const englishTitle = await findEnglishEditionTitle(workKey);

      // Double-check English title if the OL resolved one
      if (englishTitle && !isEnglishTitle(englishTitle)) {
        console.log(`[cascade-import] Skipping non-English resolved: "${englishTitle}"`);
        continue;
      }

      // Apply title normalization at import time
      const finalTitle = normalizeTitleSanitize(englishTitle ?? work.title);

      // Fuzzy dedup: skip if normalized title matches an existing book by same author
      const normalizedNew = normalizeTitleForDedup(finalTitle);
      if (normalizedNew && existingTitles.has(normalizedNew)) {
        console.log(`[cascade-import] Skipping duplicate: "${finalTitle}" (matches existing)`);
        continue;
      }

      await delay(350);
      const [newBook] = await db
        .insert(books)
        .values({
          title: finalTitle,
          coverImageUrl: coverUrl,
          openLibraryKey: workKey,
          isBoxSet: isBoxSetTitle(finalTitle),
        })
        .returning();

      // Track for subsequent dedup within this batch
      existingTitles.add(normalizedNew);

      // Link to the author
      if (author) {
        await db
          .insert(bookAuthors)
          .values({ bookId: newBook.id, authorId: author.id })
          .onConflictDoNothing();
      }

      // Generate SEO slug
      await assignBookSlug(newBook.id, finalTitle, author?.name ?? "");

      // Enrich the cascade-imported book (separate serverless invocation)
      triggerEnrichment(newBook.id);
    }
  }
}

export async function importFromOpenLibrary(result: OLSearchResult) {
  // Check if OL key is blocked (deleted junk, wrong author, etc.)
  const blocked = await db.query.blockedOlKeys.findFirst({
    where: eq(blockedOlKeys.openLibraryKey, result.key),
  });
  if (blocked) {
    redirect("/search");
  }

  // Check if already imported by OL key
  const existing = await db.query.books.findFirst({
    where: eq(books.openLibraryKey, result.key),
  });
  if (existing) {
    redirect(`/book/${existing.id}`);
  }

  // Fuzzy dedup: check if a book with matching normalized title + author already exists locally
  // This catches OL works with different keys that are actually the same book
  const fuzzyMatch = await findExistingByTitleAndAuthor(
    result.title,
    result.author_name?.[0] ?? null
  );
  if (fuzzyMatch) {
    redirect(`/book/${fuzzyMatch}`);
  }

  // Fetch work details for description + cover + subjects
  const work = await fetchOpenLibraryWork(result.key);

  // Cover priority: English edition cover > work cover > search result cover
  // Uses findEnglishCover which filters by language metadata to avoid non-English covers
  const { coverId: englishCoverId } = await findEnglishCover(result.key);
  const coverUrl =
    buildCoverUrl(englishCoverId, "L") ??
    buildCoverUrl(work.coverId, "L") ??
    buildCoverUrl(result.cover_i, "L");

  // Normalize genres first so we can detect fiction/nonfiction
  const genreNames = normalizeGenres(work.subjects);
  const isFiction = detectIsFiction(genreNames);

  // Prefer the work title from OL (cleaner) over search result title (may include edition info)
  // Apply title normalization (strip junk suffixes, fix capitalization)
  // Also try to resolve an English edition title if the work title looks non-English
  let rawTitle = work.title || result.title;
  if (!isEnglishTitle(rawTitle)) {
    const englishTitle = await findEnglishEditionTitle(result.key);
    if (englishTitle && isEnglishTitle(englishTitle)) {
      rawTitle = englishTitle;
    }
  }
  const bookTitle = normalizeTitleSanitize(rawTitle);

  // Validate title — reject junk entries, clean parenthetical series info
  const validation = validateBookTitle(bookTitle);
  if (!validation.ok) {
    console.log(`[import] Rejected "${bookTitle}": ${validation.reason}`);
    redirect("/search");
  }
  const finalTitle = validation.title;

  // Sanitize description at import time (strip HTML/links/URLs, keep full length)
  const cleanDescription = work.description ? sanitizeDescription(work.description) : null;

  // Insert book
  const [book] = await db
    .insert(books)
    .values({
      title: finalTitle,
      description: cleanDescription,
      publicationYear: result.first_publish_year ?? null,
      isbn13: result.isbn?.find((i) => i.length === 13) ?? null,
      isbn10: result.isbn?.find((i) => i.length === 10) ?? null,
      pages: result.number_of_pages_median,
      coverImageUrl: coverUrl,
      openLibraryKey: result.key,
      isFiction,
      isBoxSet: isBoxSetTitle(bookTitle),
    })
    .returning();

  // Insert authors (with OL keys)
  const authorOlKeys: string[] = [];
  if (result.author_name?.length) {
    for (let i = 0; i < result.author_name.length; i++) {
      const name = result.author_name[i];
      const olKey = result.author_key?.[i];
      const authorId = await findOrCreateAuthor(name, olKey);
      await db
        .insert(bookAuthors)
        .values({ bookId: book.id, authorId })
        .onConflictDoNothing();
      if (olKey) authorOlKeys.push(olKey);
    }
  }

  // Insert genres (title-cased to prevent duplicates)
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
      .values({ bookId: book.id, genreId: genre.id })
      .onConflictDoNothing();
  }

  // Generate SEO slug
  const slug = await assignBookSlug(book.id, bookTitle, result.author_name?.[0] ?? "");

  // Enrich with content ratings, summary, tags
  // Uses after() to trigger a separate serverless invocation that awaits enrichment
  after(() => triggerEnrichment(book.id));

  // Cascade: import other books by these authors
  if (authorOlKeys.length > 0) {
    after(() => {
      importCascadeBooks(authorOlKeys).catch((err) => {
        console.error("Cascade import error:", err);
      });
    });
  }

  redirect(`/book/${slug || book.id}`);
}

// Same as importFromOpenLibrary but returns book ID instead of redirecting
export async function importFromOpenLibraryAndReturn(result: OLSearchResult): Promise<string | null> {
  // Check if OL key is blocked
  const blocked = await db.query.blockedOlKeys.findFirst({
    where: eq(blockedOlKeys.openLibraryKey, result.key),
  });
  if (blocked) return null;

  // Check if already imported by OL key
  const existing = await db.query.books.findFirst({
    where: eq(books.openLibraryKey, result.key),
  });
  if (existing) {
    return existing.id;
  }

  // Fuzzy dedup: check if a book with matching normalized title + author already exists locally
  const fuzzyMatch = await findExistingByTitleAndAuthor(
    result.title,
    result.author_name?.[0] ?? null
  );
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  const work = await fetchOpenLibraryWork(result.key);

  // Cover priority: English edition cover > work cover > search result cover
  const { coverId: englishCoverId } = await findEnglishCover(result.key);
  const coverUrl =
    buildCoverUrl(englishCoverId, "L") ??
    buildCoverUrl(work.coverId, "L") ??
    buildCoverUrl(result.cover_i, "L");

  const genreNames = normalizeGenres(work.subjects);
  const isFiction = detectIsFiction(genreNames);

  // Resolve English title if work title looks non-English
  let rawTitle = work.title || result.title;
  if (!isEnglishTitle(rawTitle)) {
    const englishTitle = await findEnglishEditionTitle(result.key);
    if (englishTitle && isEnglishTitle(englishTitle)) {
      rawTitle = englishTitle;
    }
  }
  const bookTitle = normalizeTitleSanitize(rawTitle);

  // Validate title — reject junk, clean parentheticals
  const validation = validateBookTitle(bookTitle);
  if (!validation.ok) {
    console.log(`[import] Rejected "${bookTitle}": ${validation.reason}`);
    return null;
  }
  const finalTitle = validation.title;

  const cleanDescription = work.description ? sanitizeDescription(work.description) : null;

  const [book] = await db
    .insert(books)
    .values({
      title: finalTitle,
      description: cleanDescription,
      publicationYear: result.first_publish_year ?? null,
      isbn13: result.isbn?.find((i) => i.length === 13) ?? null,
      isbn10: result.isbn?.find((i) => i.length === 10) ?? null,
      pages: result.number_of_pages_median,
      coverImageUrl: coverUrl,
      openLibraryKey: result.key,
      isFiction,
      isBoxSet: isBoxSetTitle(bookTitle),
    })
    .returning();

  const authorOlKeys: string[] = [];
  if (result.author_name?.length) {
    for (let i = 0; i < result.author_name.length; i++) {
      const name = result.author_name[i];
      const olKey = result.author_key?.[i];
      const authorId = await findOrCreateAuthor(name, olKey);
      await db
        .insert(bookAuthors)
        .values({ bookId: book.id, authorId })
        .onConflictDoNothing();
      if (olKey) authorOlKeys.push(olKey);
    }
  }

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
      .values({ bookId: book.id, genreId: genre.id })
      .onConflictDoNothing();
  }

  // Generate SEO slug
  await assignBookSlug(book.id, bookTitle, result.author_name?.[0] ?? "");

  // Enrich with content ratings, summary, tags
  after(() => triggerEnrichment(book.id));

  if (authorOlKeys.length > 0) {
    after(() => {
      importCascadeBooks(authorOlKeys).catch((err) => {
        console.error("Cascade import error:", err);
      });
    });
  }

  return book.id;
}

export async function createBookManually(formData: FormData) {
  const title = formData.get("title") as string;
  const authorName = formData.get("author") as string;
  const description = (formData.get("description") as string) || null;
  const yearStr = formData.get("year") as string;
  // Normalize ISBNs immediately — users paste hyphenated ISBNs from Amazon
  // (e.g. "978-1635575637") which break all downstream OL/ISBNdb lookups.
  const rawIsbn13 = (formData.get("isbn13") as string) || null;
  const rawIsbn10 = (formData.get("isbn10") as string) || null;
  const normalizeIsbn = (raw: string | null): string | null => {
    if (!raw) return null;
    const cleaned = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
    return cleaned.length >= 10 ? cleaned : null;
  };
  const isbn13 = normalizeIsbn(rawIsbn13);
  const isbn10 = normalizeIsbn(rawIsbn10);
  const pagesStr = formData.get("pages") as string;
  let coverImageUrl = (formData.get("coverImageUrl") as string) || null;
  const audioLengthStr = formData.get("audioLengthMinutes") as string;
  const asin = (formData.get("asin") as string) || null;
  const isFictionVal = formData.get("isFiction") as string;
  const narratorName = formData.get("narrator") as string;

  if (!title?.trim()) {
    throw new Error("Title is required");
  }

  // Handle cover file upload
  const coverFile = formData.get("coverFile") as File | null;
  if (coverFile && coverFile.size > 0) {
    const ext = coverFile.name.split(".").pop()?.toLowerCase() || "jpg";
    const allowedExts = ["jpg", "jpeg", "png", "webp"];
    if (!allowedExts.includes(ext)) throw new Error("Invalid image type");
    if (coverFile.size > 1024 * 1024) throw new Error("Cover image must be under 1 MB");

    const filename = `cover-${Date.now()}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "covers");
    await mkdir(uploadDir, { recursive: true });
    const buffer = Buffer.from(await coverFile.arrayBuffer());
    await writeFile(path.join(uploadDir, filename), buffer);
    coverImageUrl = `/uploads/covers/${filename}`;
  }

  const [book] = await db
    .insert(books)
    .values({
      title: title.trim(),
      description,
      publicationYear: yearStr ? parseInt(yearStr, 10) : null,
      isbn13,
      isbn10,
      pages: pagesStr ? parseInt(pagesStr, 10) : null,
      coverImageUrl,
      audioLengthMinutes: audioLengthStr ? parseInt(audioLengthStr, 10) : null,
      asin,
      isFiction: isFictionVal !== "nonfiction",
      isBoxSet: isBoxSetTitle(title.trim()),
    })
    .returning();

  if (authorName?.trim()) {
    const authorId = await findOrCreateAuthor(authorName.trim());
    await db
      .insert(bookAuthors)
      .values({ bookId: book.id, authorId })
      .onConflictDoNothing();
  }

  if (narratorName?.trim()) {
    let narrator = await db.query.narrators.findFirst({
      where: eq(narrators.name, narratorName.trim()),
    });
    if (!narrator) {
      [narrator] = await db
        .insert(narrators)
        .values({ name: narratorName.trim() })
        .returning();
    }
    await db
      .insert(bookNarrators)
      .values({ bookId: book.id, narratorId: narrator.id });
  }

  // Generate SEO slug
  const slug = await assignBookSlug(book.id, title.trim(), authorName?.trim() ?? "");

  // Update FTS search index immediately so the book is searchable
  const { updateSearchIndex } = await import("@/lib/search/search-index");
  await updateSearchIndex(book.id);

  // Enrich with content ratings, summary, tags
  after(() => triggerEnrichment(book.id));

  redirect(`/book/${slug || book.id}`);
}

export async function setBookCover(
  bookId: string,
  coverUrl: string | null
): Promise<{ success: boolean; error?: string }> {
  const { getCurrentUser } = await import("@/lib/auth");
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false, error: "Unauthorized" };

  // Validate URL looks like an image, not a webpage
  if (coverUrl) {
    try {
      const parsed = new URL(coverUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { success: false, error: "URL must be http or https" };
      }
      // Reject URLs that are clearly web pages (Amazon product pages, etc.)
      const lowerPath = parsed.pathname.toLowerCase();
      const lowerHost = parsed.hostname.toLowerCase();
      const isKnownImageHost =
        lowerHost.includes("covers.openlibrary.org") ||
        lowerHost.includes("books.google.com") ||
        lowerHost.includes("images-na.ssl-images-amazon.com") ||
        lowerHost.includes("m.media-amazon.com") ||
        lowerHost.includes("i.imgur.com");
      const hasImageExtension = /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(lowerPath);
      const isAmazonProductPage = lowerHost.includes("amazon.com") && lowerPath.includes("/dp/");

      if (isAmazonProductPage) {
        return { success: false, error: "That's an Amazon product page URL, not an image. Right-click the cover image and copy the image address instead." };
      }
      if (!isKnownImageHost && !hasImageExtension) {
        return { success: false, error: "URL doesn't appear to be an image. Make sure it ends with .jpg, .png, .webp, etc." };
      }
    } catch {
      return { success: false, error: "Invalid URL" };
    }
  }

  const { revalidatePath } = await import("next/cache");

  await db
    .update(books)
    .set({ coverImageUrl: coverUrl || null })
    .where(eq(books.id, bookId));

  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

/**
 * Set or clear the audiobook-specific cover for a book (admin only).
 * This cover shows when a user is reading the audiobook format.
 */
export async function setAudiobookCover(
  bookId: string,
  coverUrl: string | null
): Promise<{ success: boolean; error?: string }> {
  const { getCurrentUser } = await import("@/lib/auth");
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false, error: "Unauthorized" };

  if (coverUrl) {
    try {
      const parsed = new URL(coverUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { success: false, error: "URL must be http or https" };
      }
    } catch {
      return { success: false, error: "Invalid URL" };
    }
  }

  const { revalidatePath } = await import("next/cache");

  await db
    .update(books)
    .set({ audiobookCoverUrl: coverUrl || null })
    .where(eq(books.id, bookId));

  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

/**
 * Upload a cover image file for a book (admin only).
 * Saves to /public/uploads/covers/ and sets coverImageUrl.
 */
export async function uploadBookCover(
  bookId: string,
  formData: FormData
): Promise<{ success: boolean; url?: string; error?: string }> {
  const { getCurrentUser } = await import("@/lib/auth");
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false, error: "Unauthorized" };

  const file = formData.get("cover") as File | null;
  if (!file || file.size === 0) return { success: false, error: "No file provided" };
  if (file.size > 2 * 1024 * 1024) return { success: false, error: "File too large (max 2MB)" };

  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!validTypes.includes(file.type)) return { success: false, error: "Invalid file type (JPG, PNG, WebP only)" };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const filename = `cover-${Date.now()}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads", "covers");

  await mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  const url = `/uploads/covers/${filename}`;
  await db.update(books).set({ coverImageUrl: url, coverSource: "manual" }).where(eq(books.id, bookId));

  const { revalidatePath } = await import("next/cache");
  revalidatePath(`/book/${bookId}`);
  return { success: true, url };
}

/** Allowed fields for admin inline editing */
type EditableBookFields = {
  title?: string;
  publicationYear?: number | null;
  publicationDate?: string | null;
  pages?: number | null;
  audioLengthMinutes?: number | null;
  publisher?: string | null;
  language?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  asin?: string | null;
  isFiction?: boolean | null;
  description?: string | null;
  summary?: string | null;
};

/**
 * Update any combination of book fields (admin only).
 * Only updates fields that are explicitly provided.
 */
export async function updateBookFields(
  bookId: string,
  fields: EditableBookFields
): Promise<{ success: boolean; error?: string }> {
  const { getCurrentUser } = await import("@/lib/auth");
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false, error: "Unauthorized" };

  // Build the update set, filtering out undefined values
  const updateSet: Record<string, unknown> = {};
  if (fields.title !== undefined) updateSet.title = fields.title;
  if (fields.publicationYear !== undefined) updateSet.publicationYear = fields.publicationYear;
  if (fields.publicationDate !== undefined) updateSet.publicationDate = fields.publicationDate;
  if (fields.pages !== undefined) updateSet.pages = fields.pages;
  if (fields.audioLengthMinutes !== undefined) updateSet.audioLengthMinutes = fields.audioLengthMinutes;
  if (fields.publisher !== undefined) updateSet.publisher = fields.publisher;
  if (fields.language !== undefined) updateSet.language = fields.language;
  if (fields.isbn13 !== undefined) updateSet.isbn13 = fields.isbn13;
  if (fields.isbn10 !== undefined) updateSet.isbn10 = fields.isbn10;
  if (fields.asin !== undefined) updateSet.asin = fields.asin;
  if (fields.isFiction !== undefined) updateSet.isFiction = fields.isFiction;
  if (fields.description !== undefined) updateSet.description = fields.description;
  if (fields.summary !== undefined) updateSet.summary = fields.summary;

  if (Object.keys(updateSet).length === 0) {
    return { success: false, error: "No fields to update" };
  }

  await db.update(books).set(updateSet).where(eq(books.id, bookId));

  const { revalidatePath } = await import("next/cache");
  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

/**
 * Add a genre to a book (admin only). Creates the genre if it doesn't exist.
 */
export async function addBookGenre(
  bookId: string,
  genreName: string
): Promise<{ success: boolean; error?: string }> {
  const { getCurrentUser } = await import("@/lib/auth");
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false, error: "Unauthorized" };

  const normalized = titleCaseGenre(genreName.trim());
  if (!normalized) return { success: false, error: "Empty genre name" };

  // Find or create genre
  let genre = await db.select().from(genres).where(eq(genres.name, normalized)).get();
  if (!genre) {
    await db.insert(genres).values({ name: normalized });
    genre = await db.select().from(genres).where(eq(genres.name, normalized)).get();
  }

  if (!genre) return { success: false, error: "Failed to create genre" };

  // Link to book (ignore if already linked)
  await db.insert(bookGenres).values({ bookId, genreId: genre.id }).onConflictDoNothing();

  const { revalidatePath } = await import("next/cache");
  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

/**
 * Remove a genre from a book (admin only).
 */
export async function removeBookGenre(
  bookId: string,
  genreName: string
): Promise<{ success: boolean; error?: string }> {
  const { getCurrentUser } = await import("@/lib/auth");
  const session = await getCurrentUser();
  if (session?.role !== "admin") return { success: false, error: "Unauthorized" };

  const genre = await db.select().from(genres).where(eq(genres.name, genreName)).get();
  if (!genre) return { success: false, error: "Genre not found" };

  await db.delete(bookGenres).where(
    sql`${bookGenres.bookId} = ${bookId} AND ${bookGenres.genreId} = ${genre.id}`
  );

  const { revalidatePath } = await import("next/cache");
  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

/**
 * Import a book from an ISBNdb search result and return the local book ID.
 * Used by the search page when the user picks a result that came from
 * /api/search/external (ISBNdb-sourced).
 *
 * Strategy: minimal book row insert (title + authors + isbn + cover), then
 * trigger enrichment in the background to fill in the rest. This keeps the
 * search → click → state-change flow snappy.
 */
export async function importFromISBNdbAndReturn(params: {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl?: string | null;
  publicationYear?: number | null;
  pages?: number | null;
}): Promise<string | null> {
  const { isbn, title, authors: authorNames, coverUrl, publicationYear, pages } = params;

  // 1. Normalize the ISBN to digits-only (with optional trailing 'X' for
  // ISBN-10 checksum). ISBNdb and other sources return ISBNs in wildly
  // inconsistent formats — "978-1250394958", "9781250394958", "978-1-250-
  // 39495-8", etc. Our dedup check needs a canonical form to reliably
  // match against what's already in the DB.
  const cleaned = isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
  const isbn13 = cleaned.length === 13 ? cleaned : null;
  const isbn10 = cleaned.length === 10 ? cleaned : null;

  // Dedup by ISBN — book might already be in our DB under either format
  if (isbn13) {
    const existing = await db.query.books.findFirst({ where: eq(books.isbn13, isbn13) });
    if (existing) return existing.id;
  }
  if (isbn10) {
    const existing = await db.query.books.findFirst({ where: eq(books.isbn10, isbn10) });
    if (existing) return existing.id;
  }

  // 2. Fuzzy dedup by title + first author. Normalize curly quotes before
  // the match so "Hell's Heart" (straight) still matches "Hell\u2019s Heart"
  // (curly) in the DB.
  const titleForFuzzy = title.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  const fuzzyMatch = await findExistingByTitleAndAuthor(titleForFuzzy, authorNames[0] ?? null);
  if (fuzzyMatch) return fuzzyMatch;

  // 3. Validate title — reject junk
  const validation = validateBookTitle(title);
  if (!validation.ok) {
    console.log(`[isbndb-import] Rejected "${title}": ${validation.reason}`);
    return null;
  }
  const finalTitle = validation.title;

  // 4. Insert minimal book row. Wrap in try/catch so a UNIQUE-constraint
  // collision (book with the same ISBN is already on Turso, just missed
  // by the dedup step above due to format drift) doesn't crash the import
  // — we retry the lookup and return the existing book id instead.
  let book;
  try {
    [book] = await db
      .insert(books)
      .values({
        title: finalTitle,
        isbn13,
        isbn10,
        publicationYear: publicationYear ?? null,
        pages: pages ?? null,
        coverImageUrl: coverUrl ?? null,
        // isFiction defaults to true; enrichment will refine
      })
      .returning();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed: books.isbn_13") && isbn13) {
      const existing = await db.query.books.findFirst({ where: eq(books.isbn13, isbn13) });
      if (existing) return existing.id;
    }
    if (msg.includes("UNIQUE constraint failed: books.isbn_10") && isbn10) {
      const existing = await db.query.books.findFirst({ where: eq(books.isbn10, isbn10) });
      if (existing) return existing.id;
    }
    throw err;
  }

  // 5. Link authors
  for (const name of authorNames) {
    if (!name?.trim()) continue;
    const authorId = await findOrCreateAuthor(name.trim());
    await db.insert(bookAuthors).values({ bookId: book.id, authorId }).onConflictDoNothing();
  }

  // 6. Generate slug
  await assignBookSlug(book.id, finalTitle, authorNames[0] ?? "");

  // 7. Update FTS search index so the book is searchable immediately
  const { updateSearchIndex } = await import("@/lib/search/search-index");
  await updateSearchIndex(book.id);

  // 8. Trigger enrichment in the background to fill description, genres, ratings, etc.
  after(() => triggerEnrichment(book.id));

  return book.id;
}
