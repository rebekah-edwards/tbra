import type { MetadataRoute } from "next";
import { db } from "@/db";
import { books, authors, series, users } from "@/db/schema";
import { isNotNull, eq, and, sql } from "drizzle-orm";

// Runtime generation — Turso queries are too slow for build-time
export const dynamic = "force-dynamic";
export const revalidate = 3600; // cache for 1 hour

const BASE_URL = "https://thebasedreader.app";
const BOOKS_PER_SITEMAP = 5000;

/**
 * Generate sitemap index with multiple sub-sitemaps:
 *   /sitemap/0.xml — static pages + users + series + authors
 *   /sitemap/1.xml — books 0-4999
 *   /sitemap/2.xml — books 5000-9999
 *   etc.
 */
export async function generateSitemaps() {
  const countRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(books)
    .where(and(isNotNull(books.slug), eq(books.visibility, "public")));

  const bookCount = countRow[0]?.count ?? 0;
  const bookSitemaps = Math.ceil(bookCount / BOOKS_PER_SITEMAP);

  // id 0 = static + authors + series + users
  // id 1..N = book pages in chunks
  const ids = [{ id: 0 }];
  for (let i = 1; i <= bookSitemaps; i++) {
    ids.push({ id: i });
  }
  return ids;
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  if (id === 0) {
    // Static pages + authors + series + users
    const staticPages: MetadataRoute.Sitemap = [
      { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
      { url: `${BASE_URL}/discover`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
      { url: `${BASE_URL}/browse`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
      { url: `${BASE_URL}/methodology`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
      { url: `${BASE_URL}/contact`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
      { url: `${BASE_URL}/signup`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.4 },
    ];

    // Authors (use slug if available, fallback to id)
    const authorRows = await db
      .select({ id: authors.id, slug: authors.slug })
      .from(authors);

    const authorPages: MetadataRoute.Sitemap = authorRows.map((a) => ({
      url: `${BASE_URL}/author/${a.slug || a.id}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));

    // Series
    const seriesRows = await db
      .select({ slug: series.slug })
      .from(series)
      .where(isNotNull(series.slug));

    const seriesPages: MetadataRoute.Sitemap = seriesRows
      .filter((s) => s.slug)
      .map((s) => ({
        url: `${BASE_URL}/series/${s.slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }));

    // Users
    const userRows = await db
      .select({ username: users.username })
      .from(users)
      .where(isNotNull(users.username));

    const userPages: MetadataRoute.Sitemap = userRows
      .filter((u) => u.username)
      .map((u) => ({
        url: `${BASE_URL}/u/${u.username}`,
        changeFrequency: "weekly" as const,
        priority: 0.4,
      }));

    return [...staticPages, ...authorPages, ...seriesPages, ...userPages];
  }

  // Book sitemaps: paginated chunks of 5,000
  const offset = (id - 1) * BOOKS_PER_SITEMAP;
  const bookRows = await db
    .select({ slug: books.slug })
    .from(books)
    .where(and(isNotNull(books.slug), eq(books.visibility, "public")))
    .orderBy(books.slug)
    .limit(BOOKS_PER_SITEMAP)
    .offset(offset);

  return bookRows
    .filter((b) => b.slug)
    .map((b) => ({
      url: `${BASE_URL}/book/${b.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
}
