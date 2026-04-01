import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { books } from "@/db/schema";
import { isNotNull, eq, and } from "drizzle-orm";

const BASE_URL = "https://thebasedreader.app";
const PER_PAGE = 5000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ page: string }> }
) {
  const { page } = await params;
  const pageNum = parseInt(page, 10);
  if (isNaN(pageNum) || pageNum < 1) {
    return new NextResponse("Invalid page", { status: 400 });
  }

  const offset = (pageNum - 1) * PER_PAGE;
  const bookRows = await db
    .select({ slug: books.slug })
    .from(books)
    .where(and(isNotNull(books.slug), eq(books.visibility, "public")))
    .orderBy(books.slug)
    .limit(PER_PAGE)
    .offset(offset);

  const urls = bookRows
    .filter((b) => b.slug)
    .map((b) => `  <url><loc>${BASE_URL}/book/${b.slug}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
