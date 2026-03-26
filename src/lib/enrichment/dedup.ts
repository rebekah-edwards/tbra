/**
 * Duplicate detection for book imports.
 * Checks OL key, ISBN, and normalized title+author before allowing insertion.
 */
import { db } from "@/db";
import { books, bookAuthors, authors } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const EDITION_MARKERS = /\s*[\(\[:]?\s*(?:Annotated|Illustrated|Unabridged|Abridged|Revised|Updated|Expanded|Deluxe|Special|Collector'?s?|Limited|Mass Market|Trade|Paperback|Hardcover|Large Print|Large Type|Book Club|Library|Movie Tie-[Ii]n|Media Tie-[Ii]n|Film Tie-[Ii]n|TV Tie-[Ii]n|Tie-[Ii]n|Reprint|New Edition|\d+(?:st|nd|rd|th)\s+(?:Anniversary\s+)?Edition|Classic|Original|International|Student|Teacher|Norton Critical|Penguin Classics|Modern Library|Dover Thrift|Signet Classic|Vintage|Bantam|Wordsworth|Enriched Classic|Signed|B&N Exclusive)s?\s*(?:Edition|Version|Ed\.?)?\s*[\)\]]?\s*$/i;

function normalizeTitle(title: string): string {
  let t = title.toLowerCase().trim();
  // Strip edition markers
  t = t.replace(EDITION_MARKERS, '').trim();
  // Strip series suffixes in parens
  t = t.replace(/\s*[\(\[].*?[\)\]]/g, '');
  // Strip leading articles
  t = t.replace(/^(the|a|an)\s+/, '');
  // Strip non-alphanumeric
  t = t.replace(/[^a-z0-9]/g, '');
  return t;
}

function normalizeAuthor(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

export interface DuplicateResult {
  existingId: string;
  existingTitle: string;
  matchType: 'ol_key' | 'isbn' | 'title_author';
}

/**
 * Check if a book already exists in the database.
 * Returns the existing book ID if found, null otherwise.
 */
export async function findDuplicateBook(opts: {
  title: string;
  authors: string[];
  olKey?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
}): Promise<DuplicateResult | null> {
  // 1. Check by OL key
  if (opts.olKey) {
    const existing = await db.query.books.findFirst({
      where: eq(books.openLibraryKey, opts.olKey),
      columns: { id: true, title: true },
    });
    if (existing) return { existingId: existing.id, existingTitle: existing.title, matchType: 'ol_key' };
  }

  // 2. Check by ISBN
  if (opts.isbn13) {
    const existing = await db.query.books.findFirst({
      where: eq(books.isbn13, opts.isbn13),
      columns: { id: true, title: true },
    });
    if (existing) return { existingId: existing.id, existingTitle: existing.title, matchType: 'isbn' };
  }
  if (opts.isbn10) {
    const existing = await db.query.books.findFirst({
      where: eq(books.isbn10, opts.isbn10),
      columns: { id: true, title: true },
    });
    if (existing) return { existingId: existing.id, existingTitle: existing.title, matchType: 'isbn' };
  }

  // 3. Check by normalized title + author
  const normTitle = normalizeTitle(opts.title);
  if (normTitle.length < 3) return null;

  // Get all books and check normalized titles — we do this in-memory because SQLite
  // doesn't have great fuzzy matching. In production with Postgres, use trigram similarity.
  const authorNorm = opts.authors.map(normalizeAuthor).filter(a => a.length > 2);
  if (authorNorm.length === 0) return null;

  // Use the first author's last name for a SQL filter to narrow results
  const firstAuthorLast = opts.authors[0]?.split(/\s+/).pop() ?? '';
  if (firstAuthorLast.length < 2) return null;

  const candidates = await db.all(sql`
    SELECT b.id, b.title FROM books b
    JOIN book_authors ba ON ba.book_id = b.id
    JOIN authors a ON ba.author_id = a.id
    WHERE a.name LIKE ${'%' + firstAuthorLast + '%'}
    AND b.is_box_set = 0
  `) as { id: string; title: string }[];

  for (const c of candidates) {
    if (normalizeTitle(c.title) === normTitle) {
      return { existingId: c.id, existingTitle: c.title, matchType: 'title_author' };
    }
  }

  return null;
}

/**
 * Merge better metadata from a candidate onto an existing book.
 * Only fills in fields that are currently null/empty on the existing record.
 */
export async function mergeMetadata(existingId: string, candidate: {
  pages?: number | null;
  publicationYear?: number | null;
  publicationDate?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  description?: string | null;
  coverImageUrl?: string | null;
  publisher?: string | null;
}): Promise<void> {
  const existing = await db.query.books.findFirst({
    where: eq(books.id, existingId),
  });
  if (!existing) return;

  const updates: Record<string, unknown> = {};
  if (!existing.pages && candidate.pages) updates.pages = candidate.pages;
  if (!existing.publicationYear && candidate.publicationYear) updates.publicationYear = candidate.publicationYear;
  if (!existing.publicationDate && candidate.publicationDate) updates.publicationDate = candidate.publicationDate;
  if (!existing.isbn13 && candidate.isbn13) updates.isbn13 = candidate.isbn13;
  if (!existing.isbn10 && candidate.isbn10) updates.isbn10 = candidate.isbn10;
  if (!existing.description && candidate.description) updates.description = candidate.description;
  if (!existing.coverImageUrl && candidate.coverImageUrl) updates.coverImageUrl = candidate.coverImageUrl;
  if (!existing.publisher && candidate.publisher) updates.publisher = candidate.publisher;

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date().toISOString();
    await db.update(books).set(updates).where(eq(books.id, existingId));
  }
}
