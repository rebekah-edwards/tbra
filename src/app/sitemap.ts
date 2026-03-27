import type { MetadataRoute } from "next";
import { db } from "@/db";
import { books, authors, series, users } from "@/db/schema";
import { isNotNull, eq, and } from "drizzle-orm";

const BASE_URL = "https://thebasedreader.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/discover`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/methodology`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/signup`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];

  // Dynamic: public books
  const bookRows = await db
    .select({ slug: books.slug })
    .from(books)
    .where(and(isNotNull(books.slug), eq(books.visibility, "public")));

  const bookPages: MetadataRoute.Sitemap = bookRows
    .filter((b) => b.slug)
    .map((b) => ({
      url: `${BASE_URL}/book/${b.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));

  // Dynamic: authors
  const authorRows = await db
    .select({ id: authors.id })
    .from(authors);

  const authorPages: MetadataRoute.Sitemap = authorRows.map((a) => ({
    url: `${BASE_URL}/author/${a.id}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  // Dynamic: series with slugs
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

  // Dynamic: public user profiles
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

  return [...staticPages, ...bookPages, ...authorPages, ...seriesPages, ...userPages];
}
