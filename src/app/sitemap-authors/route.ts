import { NextResponse } from "next/server";
import { db } from "@/db";
import { authors } from "@/db/schema";

const BASE_URL = "https://thebasedreader.app";

export async function GET() {
  const authorRows = await db.select({ id: authors.id, slug: authors.slug }).from(authors);

  const urls = authorRows
    .map((a) => `  <url><loc>${BASE_URL}/author/${a.slug || a.id}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
