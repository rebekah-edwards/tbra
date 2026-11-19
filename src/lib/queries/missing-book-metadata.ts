import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getYearReads } from "./year-reads";

/**
 * Admin-only (2026-11-19): books in a reader's year of reads whose CATALOG
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
  if (reads.length === 0) return { pages: [], audio: [] };

  const needPages = new Set<string>();
  const needAudio = new Set<string>();
  for (const r of reads) {
    if (!isAudioOnly(r.activeFormats)) needPages.add(r.bookId);
    if (r.activeFormats?.includes("audiobook")) needAudio.add(r.bookId);
  }
  const ids = [...new Set([...needPages, ...needAudio])];

  const rows = (await db.all(sql`
    SELECT b.id, b.title, b.slug, b.cover_image_url, b.pages, b.audio_length_minutes,
           (SELECT GROUP_CONCAT(a.name, ', ') FROM book_authors ba JOIN authors a ON a.id = ba.author_id
             WHERE ba.book_id = b.id) AS authors,
           ual.minutes AS own_minutes
    FROM books b
    LEFT JOIN user_audio_lengths ual ON ual.book_id = b.id AND ual.user_id = ${userId}
    WHERE b.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY b.title COLLATE NOCASE
  `)) as {
    id: string; title: string; slug: string | null; cover_image_url: string | null;
    pages: number | null; audio_length_minutes: number | null; authors: string | null; own_minutes: number | null;
  }[];

  const out: MissingBookMetadata = { pages: [], audio: [] };
  for (const r of rows) {
    const book: MissingMetaBook = {
      bookId: r.id, title: r.title, slug: r.slug, coverImageUrl: r.cover_image_url,
      authors: r.authors, ownMinutes: r.own_minutes,
    };
    if (needPages.has(r.id) && !(r.pages && r.pages > 0)) out.pages.push(book);
    if (needAudio.has(r.id) && !(r.audio_length_minutes && r.audio_length_minutes > 0)) out.audio.push(book);
  }
  return out;
}
