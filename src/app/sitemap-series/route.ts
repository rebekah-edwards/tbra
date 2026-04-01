import { NextResponse } from "next/server";
import { db } from "@/db";
import { series } from "@/db/schema";
import { isNotNull } from "drizzle-orm";

const BASE_URL = "https://thebasedreader.app";

export async function GET() {
  const seriesRows = await db.select({ slug: series.slug }).from(series).where(isNotNull(series.slug));

  const urls = seriesRows
    .filter((s) => s.slug)
    .map((s) => `  <url><loc>${BASE_URL}/series/${encodeXml(s.slug!)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}

function encodeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
