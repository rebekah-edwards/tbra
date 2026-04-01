import type { MetadataRoute } from "next";
import { db } from "@/db";
import { books, authors, series, users } from "@/db/schema";
import { isNotNull, eq, and, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const BASE_URL = "https://thebasedreader.app";
const BOOKS_PER_SITEMAP = 5000;

/**
 * Single sitemap with all non-book URLs.
 * Books are in separate /sitemap-books/[page].xml routes.
 * The sitemap index is at /sitemap-index.xml (API route).
 *
 * This is the "main" sitemap — static pages + authors + series + users.
 * Kept under ~15K URLs so it loads fast.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE_URL}/discover`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/browse`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE_URL}/methodology`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/contact`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/signup`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.4 },
  ];

  const [authorRows, seriesRows, userRows] = await Promise.all([
    db.select({ id: authors.id, slug: authors.slug }).from(authors),
    db.select({ slug: series.slug }).from(series).where(isNotNull(series.slug)),
    db.select({ username: users.username }).from(users).where(isNotNull(users.username)),
  ]);

  const authorPages: MetadataRoute.Sitemap = authorRows.map((a) => ({
    url: `${BASE_URL}/author/${a.slug || a.id}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const seriesPages: MetadataRoute.Sitemap = seriesRows
    .filter((s) => s.slug)
    .map((s) => ({
      url: `${BASE_URL}/series/${s.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  const userPages: MetadataRoute.Sitemap = userRows
    .filter((u) => u.username)
    .map((u) => ({
      url: `${BASE_URL}/u/${u.username}`,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    }));

  return [...staticPages, ...authorPages, ...seriesPages, ...userPages];
}
