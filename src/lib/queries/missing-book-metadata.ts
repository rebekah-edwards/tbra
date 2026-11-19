import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getYearReads } from "./year-reads";
import { getReadingNow } from "./reading-now";

/**
 * Admin-only (2026-11-19): books in a reader's year of reads (plus, for the
 * current year, the books being read now) whose CATALOG
 * row lacks what their pages / listening totals need — no page count for a
 * print/ebook read, no audio length for a read that included the audiobook.
 * Fixing them writes the book itself (books.pages / books.audio_length_minutes),
 * so every reader's totals benefit, not just one person's goals.
 */
export interface MissingMetaBook {
  bookId: string;
  title: string;
  slug: string | null;
  coverImageUrl: string | null;
  authors: string | null;
  /** The reader's own entry for this book's audio length, if any (a prefill). */
  ownMinutes: number | null;
  /** The reader's own page count for this book, if any. */
  ownPages: number | null;
}

export interface MissingBookMetadata {
  pages: MissingMetaBook[];
  audio: MissingMetaBook[];
}

function isAudioOnly(formats: string | null): boolean {
  if (!formats) return false;
  return formats.includes("audiobook") && !formats.includes("hardcover") && !formats.includes("paperback") && !formats.includes("ebook");
}

export async function getMissingBookMetadata(userId: string, year: number): Promise<MissingBookMetadata> {
  const reads = await getYearReads(userId, year);
  // Books being read now also count partial progress toward the current
  // year's goals, so they need the same data.
  const now = year === new Date().getFullYear() ? await getReadingNow(userId) : [];

  const needPages = new Set<string>();
  const needAudio = new Set<string>();
  for (const r of reads) {
    if (!isAudioOnly(r.activeFormats)) needPages.add(r.bookId);
    if (r.activeFormats?.includes("audiobook")) needAudio.add(r.bookId);
  }
  for (const b of now) {
    const formats = JSON.stringify(b.activeFormats);
    if (!isAudioOnly(formats)) needPages.add(b.id);
    if (b.activeFormats.includes("audiobook")) needAudio.add(b.id);
  }
  if (needPages.size === 0 && needAudio.size === 0) return { pages: [], audio: [] };
  const ids = [...new Set([...needPages, ...needAudio])];

  const rows = (await db.all(sql`
    SELECT b.id, b.title, b.slug, b.cover_image_url, b.pages, b.audio_length_minutes,
           (SELECT GROUP_CONCAT(a.name, ', ') FROM book_authors ba JOIN authors a ON a.id = ba.author_id
             WHERE ba.book_id = b.id) AS authors,
           ual.minutes AS own_minutes, upc.pages AS own_pages
    FROM books b
    LEFT JOIN user_audio_lengths ual ON ual.book_id = b.id AND ual.user_id = ${userId}
    LEFT JOIN user_page_counts upc ON upc.book_id = b.id AND upc.user_id = ${userId}
    WHERE b.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY b.title COLLATE NOCASE
  `)) as {
    id: string; title: string; slug: string | null; cover_image_url: string | null;
    pages: number | null; audio_length_minutes: number | null; authors: string | null; own_minutes: number | null;
    own_pages: number | null;
  }[];

  const out: MissingBookMetadata = { pages: [], audio: [] };
  for (const r of rows) {
    const book: MissingMetaBook = {
      bookId: r.id, title: r.title, slug: r.slug, coverImageUrl: r.cover_image_url,
      authors: r.authors, ownMinutes: r.own_minutes, ownPages: r.own_pages,
    };
    if (needPages.has(r.id) && !(r.pages && r.pages > 0)) out.pages.push(book);
    if (needAudio.has(r.id) && !(r.audio_length_minutes && r.audio_length_minutes > 0)) out.audio.push(book);
  }
  return out;
}

// ── All readers (admin queue, 2026-11-19) ──
// Every book ANY reader has history with (finished, reading, paused or DNF)
// whose catalog row lacks a page count (a non-audio-only read exists) or an
// audio length (a read that included the audiobook exists). Books with a
// reader-suggested value first, then most-read, so the quickest and widest
// fixes come first. Built for
// Rebekah's assistant to work through on /admin/book-metadata?tab=all.

export const MISSING_QUEUE_PAGE_SIZE = 50;

export interface MissingQueueBook extends Omit<MissingMetaBook, "ownMinutes" | "ownPages"> {
  readers: number;
  /** Most common value readers entered for themselves (pages, or minutes for
   *  audio), and how many readers entered it. */
  suggestion: { value: number; count: number } | null;
}

const HISTORY_STATES = sql`('completed', 'currently_reading', 'paused', 'dnf')`;

/**
 * One pass per list. The lists are short (tens to a few hundred books), so
 * they come back whole and are paged in memory.
 */
async function missingQueue(kind: "pages" | "audio"): Promise<MissingQueueBook[]> {
  const formatOk =
    kind === "pages"
      ? sql`NOT (COALESCE(h.active_formats, '') LIKE '%audiobook%'
                 AND COALESCE(h.active_formats, '') NOT LIKE '%hardcover%'
                 AND COALESCE(h.active_formats, '') NOT LIKE '%paperback%'
                 AND COALESCE(h.active_formats, '') NOT LIKE '%ebook%')`
      : sql`COALESCE(h.active_formats, '') LIKE '%audiobook%'`;
  const missing =
    kind === "pages"
      ? sql`(b.pages IS NULL OR b.pages <= 0)`
      : sql`(b.audio_length_minutes IS NULL OR b.audio_length_minutes <= 0)`;

  // MATERIALIZED + CROSS JOIN pin the order: the ~17K history rows first,
  // then one primary-key lookup into books each. Left to itself the planner
  // walked all ~84K books first and took 21–45s on Turso.
  const rows = (await db.all(sql`
    WITH h AS MATERIALIZED (
      SELECT user_id, book_id, active_formats FROM reading_sessions WHERE state IN ${HISTORY_STATES}
      UNION ALL
      SELECT user_id, book_id, active_formats FROM user_book_state WHERE state IN ${HISTORY_STATES}
    )
    SELECT h.book_id AS id, COUNT(DISTINCT h.user_id) AS readers
    FROM h CROSS JOIN books b ON b.id = h.book_id
    WHERE ${missing} AND ${formatOk}
    GROUP BY h.book_id
  `)) as { id: string; readers: number }[];
  if (rows.length === 0) return [];

  const meta = (await db.all(sql`
    SELECT b.id, b.title, b.slug, b.cover_image_url,
           (SELECT GROUP_CONCAT(a.name, ', ') FROM book_authors ba JOIN authors a ON a.id = ba.author_id
             WHERE ba.book_id = b.id) AS authors
    FROM books b WHERE b.id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
  `)) as { id: string; title: string; slug: string | null; cover_image_url: string | null; authors: string | null }[];
  const byId = new Map(meta.map((m) => [m.id, m]));

  // Readers' own entries for these books — offered to the admin as a value
  // to accept. The most common value wins; ties go to the larger count of
  // readers, then the latest entry.
  const suggestionRows = (await db.all(
    kind === "pages"
      ? sql`SELECT book_id, pages AS v, COUNT(*) AS n, MAX(updated_at) AS t FROM user_page_counts
            WHERE book_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY book_id, pages`
      : sql`SELECT book_id, minutes AS v, COUNT(*) AS n, MAX(updated_at) AS t FROM user_audio_lengths
            WHERE book_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}) GROUP BY book_id, minutes`,
  )) as { book_id: string; v: number; n: number; t: string }[];
  const suggestions = new Map<string, { value: number; count: number; t: string }>();
  for (const s of suggestionRows) {
    const cur = suggestions.get(s.book_id);
    if (!cur || s.n > cur.count || (s.n === cur.count && s.t > cur.t)) {
      suggestions.set(s.book_id, { value: s.v, count: s.n, t: s.t });
    }
  }

  return rows
    .map((r) => {
      const m = byId.get(r.id);
      return m
        ? {
            bookId: r.id, title: m.title, slug: m.slug, coverImageUrl: m.cover_image_url, authors: m.authors,
            readers: r.readers,
            suggestion: suggestions.has(r.id)
              ? { value: suggestions.get(r.id)!.value, count: suggestions.get(r.id)!.count }
              : null,
          }
        : null;
    })
    .filter((b): b is MissingQueueBook => b !== null)
    // Books readers already suggested a value for come first — a one-tap
    // accept for whoever works the queue — then most-read.
    .sort(
      (a, b) =>
        Number(Boolean(b.suggestion)) - Number(Boolean(a.suggestion)) ||
        b.readers - a.readers ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
}

export async function getMissingMetadataQueue(
  kind: "pages" | "audio",
  page = 1,
): Promise<{ total: number; books: MissingQueueBook[] }> {
  const all = await missingQueue(kind);
  const start = Math.max(0, (page - 1) * MISSING_QUEUE_PAGE_SIZE);
  return { total: all.length, books: all.slice(start, start + MISSING_QUEUE_PAGE_SIZE) };
}
