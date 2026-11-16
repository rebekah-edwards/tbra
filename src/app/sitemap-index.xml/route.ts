import { NextResponse } from "next/server";
import { countIndexableBooks, SITEMAP_HEADERS } from "@/lib/seo/indexability";

const BASE_URL = "https://thebasedreader.app";
const PER_PAGE = 5000;

export async function GET() {
  // Same set sitemap-books/[page] pages through, so the page count cannot
  // drift from the pages that exist.
  const bookCount = await countIndexableBooks();
  const bookPages = Math.max(1, Math.ceil(bookCount / PER_PAGE));

  // No <lastmod> on the children: the old value was the request time, which
  // teaches Google to distrust every lastmod on the site. The per-URL lastmod
  // inside each child is the real content date.
  const locs = [
    `${BASE_URL}/sitemap.xml`,
    `${BASE_URL}/sitemap-authors`,
    `${BASE_URL}/sitemap-series`,
  ];
  for (let i = 1; i <= bookPages; i++) locs.push(`${BASE_URL}/sitemap-books/${i}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l) => `  <sitemap><loc>${l}</loc></sitemap>`).join("\n")}
</sitemapindex>`;

  return new NextResponse(xml, { headers: SITEMAP_HEADERS });
}
