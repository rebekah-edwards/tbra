/**
 * Runtime reads of the SEO core set (see ./core-set.ts for what it is and how
 * it is built). Everything here FAILS OPEN: if the table is missing, empty or
 * the query throws, pages render with no robots tag at all. A broken nightly
 * job must never be able to noindex the whole site.
 */
import { cache } from "react";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CORE_GATE } from "./core-set";

/** Below this many rows the table is treated as not-yet-populated/broken. */
const HEALTHY_MIN_ROWS = 500;
const HEALTH_TTL_MS = 10 * 60 * 1000;
let health: { at: number; ok: boolean } | null = null;

type Row = Record<string, unknown>;
const all = (q: ReturnType<typeof sql>) => (db as unknown as { all: (q: unknown) => Promise<Row[]> | Row[] }).all(q);

async function coreSetHealthy(): Promise<boolean> {
  if (health && Date.now() - health.at < HEALTH_TTL_MS) return health.ok;
  try {
    const rows = await all(sql`SELECT COUNT(*) AS n FROM seo_index_books`);
    health = { at: Date.now(), ok: Number(rows[0]?.n ?? 0) >= HEALTHY_MIN_ROWS };
  } catch {
    health = { at: Date.now(), ok: false };
  }
  return health.ok;
}

/** `robots` metadata for a page we do not want indexed (links still followed). */
export const NOINDEX_FOLLOW: NonNullable<Metadata["robots"]> = { index: false, follow: true };

/** Is this book page in the set we ask Google to index? */
export const isBookIndexable = cache(async function isBookIndexable(bookId: string): Promise<boolean> {
  try {
    if (!(await coreSetHealthy())) return true;
    const rows = await all(sql`SELECT 1 AS hit FROM seo_index_books WHERE book_id = ${bookId} LIMIT 1`);
    return rows.length > 0;
  } catch {
    return true;
  }
});

/**
 * A series page is indexable once it lists enough core books. A franchise
 * container (parent of sub-series) counts its children's books too.
 */
export const isSeriesIndexable = cache(async function isSeriesIndexable(seriesId: string): Promise<boolean> {
  try {
    if (!(await coreSetHealthy())) return true;
    const rows = await all(sql`
      SELECT COUNT(DISTINCT bs.book_id) AS n
      FROM book_series bs
      JOIN seo_index_books x ON x.book_id = bs.book_id
      WHERE bs.series_id = ${seriesId}
         OR bs.series_id IN (SELECT id FROM series WHERE parent_series_id = ${seriesId})
    `);
    return Number(rows[0]?.n ?? 0) >= CORE_GATE.minCoreBooksForListPage;
  } catch {
    return true;
  }
});

/** An author page is indexable once it lists enough core books. */
export const isAuthorIndexable = cache(async function isAuthorIndexable(authorId: string): Promise<boolean> {
  try {
    if (!(await coreSetHealthy())) return true;
    const rows = await all(sql`
      SELECT COUNT(DISTINCT ba.book_id) AS n
      FROM book_authors ba
      JOIN seo_index_books x ON x.book_id = ba.book_id
      WHERE ba.author_id = ${authorId}
    `);
    return Number(rows[0]?.n ?? 0) >= CORE_GATE.minCoreBooksForListPage;
  } catch {
    return true;
  }
});

// ─── Sitemap queries ───
// Every URL these return is a page that renders WITHOUT a noindex tag: the
// filters mirror isBookIndexable / isSeriesIndexable / isAuthorIndexable.
// scripts/sitemap-threshold-check.ts counts the same book set — keep its
// query in step with countIndexableBooks().

export interface SitemapEntry { slug: string; lastmod: string | null }

/** books.updated_at is 'YYYY-MM-DD HH:MM:SS' or ISO; sitemaps want the date. */
function toLastmod(v: unknown): string | null {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function countIndexableBooks(): Promise<number> {
  const rows = await all(sql`
    SELECT COUNT(*) AS n FROM seo_index_books x
    JOIN books b ON b.id = x.book_id
    WHERE b.visibility = 'public' AND b.slug IS NOT NULL
  `);
  return Number(rows[0]?.n ?? 0);
}

export async function listIndexableBooks(limit: number, offset: number): Promise<SitemapEntry[]> {
  const rows = await all(sql`
    SELECT b.slug AS slug, b.updated_at AS updated_at FROM seo_index_books x
    JOIN books b ON b.id = x.book_id
    WHERE b.visibility = 'public' AND b.slug IS NOT NULL
    ORDER BY b.slug LIMIT ${limit} OFFSET ${offset}
  `);
  return rows.map((r) => ({ slug: String(r.slug), lastmod: toLastmod(r.updated_at) }));
}

export async function listIndexableSeries(): Promise<SitemapEntry[]> {
  const rows = await all(sql`
    SELECT s.slug AS slug, MAX(b.updated_at) AS updated_at, COUNT(DISTINCT bs.book_id) AS n
    FROM series s
    JOIN book_series bs ON bs.series_id = s.id
    JOIN seo_index_books x ON x.book_id = bs.book_id
    JOIN books b ON b.id = bs.book_id
    WHERE s.slug IS NOT NULL
    GROUP BY s.id
    HAVING n >= ${CORE_GATE.minCoreBooksForListPage}
    ORDER BY s.slug
  `);
  return rows.map((r) => ({ slug: String(r.slug), lastmod: toLastmod(r.updated_at) }));
}

export async function listIndexableAuthors(): Promise<SitemapEntry[]> {
  const rows = await all(sql`
    SELECT a.slug AS slug, MAX(b.updated_at) AS updated_at, COUNT(DISTINCT ba.book_id) AS n
    FROM authors a
    JOIN book_authors ba ON ba.author_id = a.id
    JOIN seo_index_books x ON x.book_id = ba.book_id
    JOIN books b ON b.id = ba.book_id
    WHERE a.slug IS NOT NULL
    GROUP BY a.id
    HAVING n >= ${CORE_GATE.minCoreBooksForListPage}
    ORDER BY a.slug
  `);
  return rows.map((r) => ({ slug: String(r.slug), lastmod: toLastmod(r.updated_at) }));
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Render a <urlset>. No changefreq/priority: Google ignores both. */
export function renderUrlset(baseUrl: string, pathPrefix: string, entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const loc = `${baseUrl}${pathPrefix}${xmlEscape(e.slug)}`;
      return e.lastmod
        ? `  <url><loc>${loc}</loc><lastmod>${e.lastmod}</lastmod></url>`
        : `  <url><loc>${loc}</loc></url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export const SITEMAP_HEADERS = {
  "Content-Type": "application/xml",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};
