import { db } from "@/db";
import { editions } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import type { OLEdition } from "@/lib/openlibrary";

/**
 * Printings recorded on a book that did NOT come from OpenLibrary — the
 * ISBNdb deluxe hardcover, the anniversary edition, anything folded onto the
 * canon book at ingestion instead of being allowed to become its own entry.
 *
 * Returned in the OLEdition shape so the picker can render one merged list.
 * These are the answer to "OL doesn't list the deluxe printing, so the reader
 * can pick a format but not that specific printing" — the case the merge
 * documentation calls an honest loss of fidelity.
 */
export async function getLocalEditions(bookId: string): Promise<OLEdition[]> {
  const rows = (await db
    .select()
    .from(editions)
    .where(and(eq(editions.bookId, bookId), ne(editions.source, "openlibrary")))) as {
    openLibraryKey: string;
    title: string | null;
    publishDate: string | null;
    publishers: string | null;
    isbn13: string | null;
    isbn10: string | null;
    pages: number | null;
    format: string | null;
    coverUrl: string | null;
    editionLabel: string | null;
  }[];

  return rows.map((r) => ({
    // The stored open_library_key IS `local:<uuid>`, so a toggle round-trips
    // through importEdition() to this same row rather than inserting a copy.
    key: r.openLibraryKey,
    title: r.title ?? "",
    publish_date: r.publishDate ?? undefined,
    publishers: r.publishers ? (JSON.parse(r.publishers) as string[]) : undefined,
    isbn_13: r.isbn13 ? [r.isbn13] : undefined,
    isbn_10: r.isbn10 ? [r.isbn10] : undefined,
    number_of_pages: r.pages ?? undefined,
    physical_format: r.format ?? undefined,
    cover_url: r.coverUrl,
    edition_label: r.editionLabel,
    is_local: true,
  }));
}
