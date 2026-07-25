import { NextResponse } from "next/server";
import { db } from "@/db";
import { books, bookCategoryRatings } from "@/db/schema";
import { isNotNull, eq, and, sql, exists } from "drizzle-orm";

const BASE_URL = "https://thebasedreader.app";
const PER_PAGE = 5000;

export async function GET() {
  // Ratings-exist filter must match sitemap-books/[page] exactly, or the
  // page count drifts from the actual pages.
  const countRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(books)
    .where(and(
      isNotNull(books.slug),
      eq(books.visibility, "public"),
      exists(
        db.select({ id: bookCategoryRatings.id })
          .from(bookCategoryRatings)
          .where(eq(bookCategoryRatings.bookId, books.id))
      ),
    ));

  const bookCount = countRow[0]?.count ?? 0;
  const bookPages = Math.ceil(bookCount / PER_PAGE);

  const now = new Date().toISOString();

  const sitemaps = [
    `  <sitemap><loc>${BASE_URL}/sitemap.xml</loc><lastmod>${now}</lastmod></sitemap>`,
    `  <sitemap><loc>${BASE_URL}/sitemap-authors</loc><lastmod>${now}</lastmod></sitemap>`,
    `  <sitemap><loc>${BASE_URL}/sitemap-series</loc><lastmod>${now}</lastmod></sitemap>`,
    `  <sitemap><loc>${BASE_URL}/sitemap-users</loc><lastmod>${now}</lastmod></sitemap>`,
  ];

  for (let i = 1; i <= bookPages; i++) {
    sitemaps.push(`  <sitemap><loc>${BASE_URL}/sitemap-books/${i}</loc><lastmod>${now}</lastmod></sitemap>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.join("\n")}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
