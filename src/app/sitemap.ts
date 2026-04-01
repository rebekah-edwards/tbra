import type { MetadataRoute } from "next";
import { db } from "@/db";
import { books, authors, series, users } from "@/db/schema";
import { isNotNull, eq, and, sql } from "drizzle-orm";

// Runtime generation — Turso queries are too slow for build-time
export const dynamic = "force-dynamic";
export const revalidate = 3600; // cache for 1 hour

const BASE_URL = "https://thebasedreader.app";
const PER_SITEMAP = 5000;

// ID scheme:
//   0        = static pages + user profiles
//   100-199  = books (100 = first 5K, 101 = next 5K, etc.)
//   200      = authors
//   300      = series

export async function generateSitemaps() {
  const [bookCount, authorCount, seriesCount] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` }).from(books)
      .where(and(isNotNull(books.slug), eq(books.visibility, "public"))),
    db.select({ count: sql<number>`COUNT(*)` }).from(authors),
    db.select({ count: sql<number>`COUNT(*)` }).from(series)
      .where(isNotNull(series.slug)),
  ]);

  const numBooks = bookCount[0]?.count ?? 0;
  const bookChunks = Math.ceil(numBooks / PER_SITEMAP);

  const ids = [
    { id: 0 },   // static + users
    { id: 200 }, // authors
    { id: 300 }, // series
  ];

  // Book chunks: 100, 101, 102, etc.
  for (let i = 0; i < bookChunks; i++) {
    ids.push({ id: 100 + i });
  }

  return ids;
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  // ─── Static pages + user profiles ───
  if (id === 0) {
    const staticPages: MetadataRoute.Sitemap = [
      { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
      { url: `${BASE_URL}/discover`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
      { url: `${BASE_URL}/browse`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
      { url: `${BASE_URL}/methodology`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
      { url: `${BASE_URL}/contact`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
      { url: `${BASE_URL}/signup`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.4 },
    ];

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

    return [...staticPages, ...userPages];
  }

  // ─── Books (paginated: id 100 = offset 0, 101 = offset 5000, etc.) ───
  if (id >= 100 && id < 200) {
    const offset = (id - 100) * PER_SITEMAP;
    const bookRows = await db
      .select({ slug: books.slug })
      .from(books)
      .where(and(isNotNull(books.slug), eq(books.visibility, "public")))
      .orderBy(books.slug)
      .limit(PER_SITEMAP)
      .offset(offset);

    return bookRows
      .filter((b) => b.slug)
      .map((b) => ({
        url: `${BASE_URL}/book/${b.slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }));
  }

  // ─── Authors ───
  if (id === 200) {
    const authorRows = await db
      .select({ id: authors.id, slug: authors.slug })
      .from(authors);

    return authorRows.map((a) => ({
      url: `${BASE_URL}/author/${a.slug || a.id}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));
  }

  // ─── Series ───
  if (id === 300) {
    const seriesRows = await db
      .select({ slug: series.slug })
      .from(series)
      .where(isNotNull(series.slug));

    return seriesRows
      .filter((s) => s.slug)
      .map((s) => ({
        url: `${BASE_URL}/series/${s.slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }));
  }

  return [];
}
