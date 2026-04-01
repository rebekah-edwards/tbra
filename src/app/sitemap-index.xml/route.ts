import { NextResponse } from "next/server";
import { db } from "@/db";
import { books } from "@/db/schema";
import { isNotNull, eq, and, sql } from "drizzle-orm";

const BASE_URL = "https://thebasedreader.app";
const PER_PAGE = 5000;

export async function GET() {
  const countRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(books)
    .where(and(isNotNull(books.slug), eq(books.visibility, "public")));

  const bookCount = countRow[0]?.count ?? 0;
  const bookPages = Math.ceil(bookCount / PER_PAGE);

  const now = new Date().toISOString();

  const sitemaps = [
    // Main sitemap: static pages + authors + series + users
    `  <sitemap><loc>${BASE_URL}/sitemap.xml</loc><lastmod>${now}</lastmod></sitemap>`,
  ];

  // Book sitemaps: paginated
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
