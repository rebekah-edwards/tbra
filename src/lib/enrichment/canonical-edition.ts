/**
 * Canonical-book resolution for edition variants.
 *
 * Every ingestion path (search adds, manual adds, CSV imports, nightly
 * discovery, breadth import, upcoming releases) calls this before inserting a
 * `books` row. If the incoming title is the same work as a book we already
 * have — differing only by printing decoration — we return the existing book
 * instead of creating a second entry.
 *
 * Rebekah's standing rule: a special edition is an edition of the canon book,
 * not its own entry. See `src/lib/text/edition-title.ts` for what counts as
 * decoration (and what deliberately does not — box sets, omnibuses, volumes).
 */
import { db } from "@/db";
import { books } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { recordLocalEdition } from "@/lib/editions/record-local-edition";
import {
  editionMatchKey,
  extractEditionLabel,
  isDecoratedTitle,
  normalizeAuthor,
  normalizeTitle,
  stripEditionSuffix,
} from "@/lib/text/edition-title";

export interface CanonicalMatch {
  /** The existing book the incoming row should fold into. */
  bookId: string;
  bookTitle: string;
  /** True when the INCOMING title carried the decoration (so we can log it). */
  incomingWasDecorated: boolean;
}

/**
 * Find the canon book an edition-decorated title belongs to.
 *
 * Returns null when there is no match, or when the only candidates are
 * themselves ambiguous. Deliberately conservative — a false positive merges
 * two genuinely different books, which is far worse than leaving a duplicate
 * for `process-reports.ts` to catch later.
 */
export async function findCanonicalForEdition(
  title: string,
  authorName: string | null,
): Promise<CanonicalMatch | null> {
  if (!title?.trim() || !authorName?.trim()) return null;

  const normalized = normalizeTitle(title);
  const base = stripEditionSuffix(normalized);
  if (base.length < 3) return null;
  // "The Limited Edition" strips down to "the". A base that is nothing but an
  // article would match every book whose title reduces to the same stub, so
  // refuse it and let the row through as its own book.
  if (/^(?:the|a|an|of|and)$/.test(base)) return null;

  const incomingKey = base.replace(/ /g, "");
  const incomingWasDecorated = base !== normalized;
  const normAuthor = normalizeAuthor(authorName);
  if (!normAuthor) return null;

  // Narrowing the candidate set is subtle in both directions:
  //
  //  - The prefix MUST come from the STRIPPED title. Slicing the raw title
  //    gives 'Unravel Me Paperbac%', which cannot match the canonical "Unravel
  //    Me" — the canon is excluded before matching ever runs. That bug made
  //    every edition-variant report die as "no sibling found" until 2026-08-14.
  //
  //  - But the stripped title is NORMALIZED and `books.title` is RAW, so a
  //    multi-word prefix can't be compared directly: normalizeTitle turns
  //    "Howl's" into "howl s", and 'howl s moving castle%' matches nothing
  //    because the stored title has an apostrophe there.
  //
  // So: anchor on the FIRST normalized token only (safe — a token contains no
  // punctuation by construction) and narrow further with unanchored LIKEs on
  // the next two tokens, whose wildcards absorb whatever punctuation the raw
  // title has between them.
  const tokens = base.split(" ").filter(Boolean);
  const esc = (t: string) => t.replace(/[%_]/g, "");
  const anchor = esc(tokens[0] ?? "");
  if (!anchor) return null;
  const contains2 = tokens[1] ? `%${esc(tokens[1])}%` : null;
  const contains3 = tokens[2] ? `%${esc(tokens[2])}%` : null;

  const candidates = (await db.all(sql`
    SELECT b.id, b.title, b.visibility, a.name AS author_name,
           (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) AS user_count
    FROM books b
    JOIN book_authors ba ON ba.book_id = b.id
    JOIN authors a ON a.id = ba.author_id
    WHERE b.title LIKE ${anchor + "%"}
      ${contains2 ? sql`AND b.title LIKE ${contains2}` : sql``}
      ${contains3 ? sql`AND b.title LIKE ${contains3}` : sql``}
      AND b.is_box_set = 0
    LIMIT 300
  `)) as {
    id: string;
    title: string;
    visibility: string | null;
    author_name: string | null;
    user_count: number;
  }[];

  // Author is matched precisely in JS, not in SQL — SQL's REPLACE chain can't
  // reproduce normalizeAuthor's full punctuation stripping, and a loose LIKE
  // there would let a different author's same-titled book through.
  const group = candidates.filter(
    (c) =>
      editionMatchKey(c.title ?? "") === incomingKey &&
      normalizeAuthor(c.author_name ?? "") === normAuthor,
  );
  if (group.length === 0) return null;

  // A decorated candidate can never be the canon while an undecorated one
  // exists — the decoration is exactly what makes a row the NON-canon one, so
  // it must dominate the user-count term rather than compete with it.
  // Otherwise a deluxe row that happens to carry more shelf activity would win
  // and new adds would pile onto the wrong entry.
  const score = (c: (typeof group)[number]) =>
    (isDecoratedTitle(c.title ?? "") ? 0 : 1_000_000) +
    (c.visibility === "public" ? 100_000 : 0) +
    Number(c.user_count) * 1000;

  const best = [...group].sort((a, b) => score(b) - score(a))[0];
  return { bookId: best.id, bookTitle: best.title, incomingWasDecorated };
}

/**
 * The one call every ingestion path makes before inserting a `books` row.
 *
 * If the incoming title is an edition variant of a book we already have:
 *   1. resolve to the canon book,
 *   2. fill blanks on the canon (never overwrite good canon data — a deluxe
 *      printing's page count or cover must not replace the real book's),
 *   3. record the printing as a selectable edition so the reader can say
 *      "I own the deluxe hardcover",
 *   4. return the canon book id so the caller shelves onto it and skips the
 *      insert entirely.
 *
 * Returns null when this is genuinely a new book — the caller proceeds as before.
 */
export async function resolveEditionVariant(params: {
  title: string;
  authorName: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  pages?: number | null;
  publisher?: string | null;
  publicationYear?: number | null;
  publicationDate?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  /** hardcover | paperback | ebook | audiobook, when the source knows it. */
  format?: string | null;
  source: "isbndb" | "google_books" | "merge" | "manual";
}): Promise<{ bookId: string; bookTitle: string; editionId: string | null } | null> {
  const match = await findCanonicalForEdition(params.title, params.authorName);
  if (!match) return null;

  // Fill blanks on the canon only. An edition variant is a fine source for a
  // missing page count or ISBN, and a terrible source for REPLACING ones we
  // already have — the deluxe printing's cover must not become the book's.
  //
  // Deliberately inlined rather than calling dedup.ts's mergeMetadata:
  // findDuplicateBook there now calls into this module, and importing back
  // would close a require cycle.
  await fillBlankFields(match.bookId, params);

  // Only decorated arrivals become edition rows. An undecorated title that
  // matched an undecorated canon is a plain duplicate, not a distinct printing
  // — recording it would put a nameless entry in the picker.
  const editionId = match.incomingWasDecorated
    ? await recordLocalEdition({
        bookId: match.bookId,
        title: params.title,
        isbn13: params.isbn13 ?? null,
        isbn10: params.isbn10 ?? null,
        pages: params.pages ?? null,
        publisher: params.publisher ?? null,
        publishDate: params.publicationDate ?? (params.publicationYear ? String(params.publicationYear) : null),
        coverUrl: params.coverUrl ?? null,
        format: params.format ?? null,
        editionLabel: extractEditionLabel(params.title),
        source: params.source,
      })
    : null;

  return { bookId: match.bookId, bookTitle: match.bookTitle, editionId };
}

/** Write incoming values ONLY where the canon book is currently empty. */
async function fillBlankFields(
  bookId: string,
  incoming: {
    pages?: number | null;
    publisher?: string | null;
    publicationYear?: number | null;
    publicationDate?: string | null;
    description?: string | null;
    isbn13?: string | null;
    isbn10?: string | null;
    coverUrl?: string | null;
  },
): Promise<void> {
  const existing = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!existing) return;

  const updates: Record<string, unknown> = {};
  if (!existing.pages && incoming.pages) updates.pages = incoming.pages;
  if (!existing.publisher && incoming.publisher) updates.publisher = incoming.publisher;
  if (!existing.publicationYear && incoming.publicationYear) updates.publicationYear = incoming.publicationYear;
  if (!existing.publicationDate && incoming.publicationDate) updates.publicationDate = incoming.publicationDate;
  if (!existing.description && incoming.description) updates.description = incoming.description;
  if (!existing.coverImageUrl && incoming.coverUrl) updates.coverImageUrl = incoming.coverUrl;
  // ISBNs are UNIQUE — a claim that collides would roll back the whole write,
  // so only take one the canon lacks AND no other row already holds.
  if (!existing.isbn13 && incoming.isbn13) {
    const taken = await db.query.books.findFirst({
      where: eq(books.isbn13, incoming.isbn13),
      columns: { id: true },
    });
    if (!taken) updates.isbn13 = incoming.isbn13;
  }
  if (!existing.isbn10 && incoming.isbn10) {
    const taken = await db.query.books.findFirst({
      where: eq(books.isbn10, incoming.isbn10),
      columns: { id: true },
    });
    if (!taken) updates.isbn10 = incoming.isbn10;
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date().toISOString();
    await db.update(books).set(updates).where(eq(books.id, bookId));
  }
}
