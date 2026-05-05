/**
 * Slug generation utilities for SEO-friendly URLs.
 *
 * All slugs are lowercase, use dashes between words,
 * and strip special characters / unicode.
 */

function normalize(str: string): string {
  return str
    // Normalize unicode (e.g., accented chars → base form)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Replace any non-alphanumeric with space (preserves word boundaries)
    .replace(/[^a-zA-Z0-9\s]/g, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    // Replace spaces with dashes
    .replace(/\s/g, "-");
}

/**
 * Generate a slug for a book: `title-authorname`
 * e.g., "The Will of the Many" by James Islington → "the-will-of-the-many-james-islington"
 */
export function generateBookSlug(title: string, authorName: string): string {
  const titleSlug = normalize(title);
  const authorSlug = normalize(authorName);
  if (!authorSlug) return titleSlug;
  return `${titleSlug}-${authorSlug}`;
}

/**
 * Generate a slug for a series: `seriesname-authorname`
 * If authorName is omitted (multiple authors), just use the series name.
 * e.g., "The Silo Series" → "the-silo-series"
 */
export function generateSeriesSlug(seriesName: string, authorName?: string): string {
  const nameSlug = normalize(seriesName);
  if (!authorName) return nameSlug;
  const authorSlug = normalize(authorName);
  if (!authorSlug) return nameSlug;
  return `${nameSlug}-${authorSlug}`;
}

/**
 * Generate a slug for an author: `firstname-lastname`
 * e.g., "James Islington" → "james-islington"
 */
export function generateAuthorSlug(authorName: string): string {
  return normalize(authorName);
}

/**
 * Generate a slug for a custom shelf: just the shelf name normalized.
 * e.g., "Summer 2026 Reads" → "summer-2026-reads"
 */
export function generateShelfSlug(shelfName: string): string {
  return normalize(shelfName);
}

/**
 * Look up an existing book by what slug a fresh import would generate.
 * Used by import paths (importFromOpenLibrary, importFromISBNdbAndReturn,
 * createBookManually) to prevent the "Midnight-Is-the-Darkest-Hour" pattern
 * where two import flows independently generate the same slug for the same
 * title+author and end up as separate book rows.
 *
 * Returns the existing book's `{ id, slug }` or `null` if no collision.
 *
 * Important: callers should run this AFTER their existing dedup checks
 * (OL key, ISBN, fuzzy title+author) — those are stronger and faster.
 * This is the last-line guard for cases where the upstream dedups fail
 * (e.g. fuzzy title+author normalization disagreement, OL key mismatch
 * between sources, ISBN reformatted by source).
 */
export async function findBookBySlugCollision(
  title: string,
  authorName: string | null,
): Promise<{ id: string; slug: string | null } | null> {
  if (!title?.trim() || !authorName?.trim()) return null;
  const expectedSlug = generateBookSlug(title.trim(), authorName.trim());
  if (!expectedSlug) return null;

  const { db } = await import("@/db");
  const { books } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const existing = await db.query.books.findFirst({
    where: eq(books.slug, expectedSlug),
    columns: { id: true, slug: true },
  });
  return existing ?? null;
}

/**
 * Generate a unique book slug and save it to the database.
 * Handles collisions by appending numeric suffixes (-2, -3, etc.).
 * Call this after inserting the book and linking the author.
 */
export async function assignBookSlug(
  bookId: string,
  title: string,
  authorName: string,
): Promise<string> {
  const { db } = await import("@/db");
  const { books } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const baseSlug = generateBookSlug(title, authorName);
  if (!baseSlug) return "";

  let slug = baseSlug;
  let suffix = 2;

  // Check for collisions
  while (true) {
    const existing = await db.query.books.findFirst({
      where: eq(books.slug, slug),
      columns: { id: true },
    });
    if (!existing || existing.id === bookId) break;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

  await db.update(books).set({ slug }).where(eq(books.id, bookId));
  return slug;
}
