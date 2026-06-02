// ─── New York Times bestseller cache ───
//
// Central module for the NYT Books API integration. The NYT API has a hard limit
// of 500 requests/day and 5/min, so we NEVER call it per-book. Instead the capture
// jobs (nightly current lists + retroactive dated lists) pull each list once and
// persist every entry into the `nyt_bestsellers` table. Everything downstream —
// discovery import, enrichment, and user-import enrichment in production — reads
// that LOCAL table, so per-book NYT API usage is always zero.
//
// `db` from "@/db" resolves to the local SQLite file in scripts and to Turso in
// production, so the same match query works in both places.

import { db } from "@/db";
import { nytBestsellers } from "@/db/schema";
import { eq } from "drizzle-orm";

/** The 10 lists we capture. Fiction/nonfiction + religion are the highest-value. */
export const NYT_LISTS = [
  "combined-print-and-e-book-fiction",
  "combined-print-and-e-book-nonfiction",
  "hardcover-fiction",
  "hardcover-nonfiction",
  "trade-fiction-paperback",
  "paperback-nonfiction",
  "young-adult-hardcover",
  "childrens-middle-grade-hardcover",
  "religion-spirituality-and-faith",
  "advice-how-to-and-miscellaneous",
];

/** NYT free tier is 5 req/min → sleep ~12s between calls. */
export const NYT_DELAY_MS = 12_500;

export interface NytEntry {
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  author: string | null;
  description: string | null;
  publisher: string | null;
  bookImage: string | null;
  amazonUrl: string | null;
  rank: number | null;
  weeksOnList: number | null;
}

export interface NytFetchResult {
  ok: boolean;
  status: number;
  entries: NytEntry[];
  listDate: string | null;
}

/** Normalize a string for fuzzy matching: lowercase, strip punctuation, collapse spaces. */
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Build the "title|author" fallback match key. Author is normalized whole-string. */
export function nytTitleKey(title: string, author: string | null | undefined): string {
  return `${norm(title)}|${norm(author)}`;
}

/**
 * Fetch one NYT bestseller list. Pass a `date` (YYYY-MM-DD) for a historical week,
 * or omit it for the current list. Never throws — returns ok:false on any error.
 */
export async function fetchNytList(
  listName: string,
  apiKey: string,
  date?: string
): Promise<NytFetchResult> {
  const datePart = date ?? "current";
  const url = `https://api.nytimes.com/svc/books/v3/lists/${datePart}/${listName}.json?api-key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, status: res.status, entries: [], listDate: null };
    }
    const data: any = await res.json();
    const results = data?.results ?? {};
    const listDate: string | null =
      results.bestsellers_date ?? results.published_date ?? date ?? null;
    const entries: NytEntry[] = (results.books ?? [])
      .map((b: any) => ({
        isbn13: (b.primary_isbn13 ?? "").trim() || null,
        isbn10: (b.primary_isbn10 ?? "").trim() || null,
        title: (b.title ?? "").trim(),
        author: (b.author ?? "").trim() || null,
        description: (b.description ?? "").trim() || null,
        publisher: (b.publisher ?? "").trim() || null,
        bookImage: (b.book_image ?? "").trim() || null,
        amazonUrl: (b.amazon_product_url ?? "").trim() || null,
        rank: typeof b.rank === "number" ? b.rank : null,
        weeksOnList: typeof b.weeks_on_list === "number" ? b.weeks_on_list : null,
      }))
      .filter((e: NytEntry) => e.title.length > 0);
    return { ok: true, status: 200, entries, listDate };
  } catch {
    return { ok: false, status: 0, entries: [], listDate: null };
  }
}

function minDefined(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}
function maxDefined(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export interface UpsertStats {
  inserted: number;
  updated: number;
}

/**
 * Upsert a batch of NYT entries into the cache. Matches an existing row by ISBN-13
 * first, then by titleKey. On a match it fills gaps, keeps the best rank / max
 * weeks-on-list, and tracks the earliest list date seen.
 */
export async function upsertNytEntries(
  entries: NytEntry[],
  listName: string,
  listDate: string | null
): Promise<UpsertStats> {
  const stats: UpsertStats = { inserted: 0, updated: 0 };
  const now = new Date().toISOString();

  for (const e of entries) {
    const key = nytTitleKey(e.title, e.author);

    let existing =
      e.isbn13
        ? await db.query.nytBestsellers.findFirst({
            where: eq(nytBestsellers.isbn13, e.isbn13),
          })
        : undefined;
    if (!existing) {
      existing = await db.query.nytBestsellers.findFirst({
        where: eq(nytBestsellers.titleKey, key),
      });
    }

    if (existing) {
      await db
        .update(nytBestsellers)
        .set({
          isbn13: existing.isbn13 ?? e.isbn13,
          isbn10: existing.isbn10 ?? e.isbn10,
          author: existing.author ?? e.author,
          description: existing.description ?? e.description,
          publisher: existing.publisher ?? e.publisher,
          bookImage: existing.bookImage ?? e.bookImage,
          amazonUrl: existing.amazonUrl ?? e.amazonUrl,
          bestRank: minDefined(existing.bestRank, e.rank),
          weeksOnList: maxDefined(existing.weeksOnList, e.weeksOnList),
          firstPublishedDate: earliest(existing.firstPublishedDate, listDate),
          updatedAt: now,
        })
        .where(eq(nytBestsellers.id, existing.id));
      stats.updated++;
    } else {
      await db.insert(nytBestsellers).values({
        isbn13: e.isbn13,
        isbn10: e.isbn10,
        title: e.title,
        author: e.author,
        titleKey: key,
        description: e.description,
        publisher: e.publisher,
        bookImage: e.bookImage,
        amazonUrl: e.amazonUrl,
        firstListName: listName,
        bestRank: e.rank,
        weeksOnList: e.weeksOnList,
        firstPublishedDate: listDate,
      });
      stats.inserted++;
    }
  }
  return stats;
}

export interface NytMatch {
  description: string | null;
  publisher: string | null;
  bookImage: string | null;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  author: string | null;
}

/**
 * Look up a catalog book in the NYT cache. Tries ISBN-13 first, then the
 * normalized title|author key. Returns null if not a (cached) bestseller.
 * This is a LOCAL DB read — no NYT API call.
 */
export async function findNytMatch(book: {
  isbn13?: string | null;
  title: string;
  author?: string | null;
}): Promise<NytMatch | null> {
  let row =
    book.isbn13
      ? await db.query.nytBestsellers.findFirst({
          where: eq(nytBestsellers.isbn13, book.isbn13),
        })
      : undefined;
  if (!row) {
    const key = nytTitleKey(book.title, book.author);
    row = await db.query.nytBestsellers.findFirst({
      where: eq(nytBestsellers.titleKey, key),
    });
  }
  if (!row) return null;
  return {
    description: row.description,
    publisher: row.publisher,
    bookImage: row.bookImage,
    isbn13: row.isbn13,
    isbn10: row.isbn10,
    title: row.title,
    author: row.author,
  };
}
