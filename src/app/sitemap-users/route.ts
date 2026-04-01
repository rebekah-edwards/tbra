import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isNotNull } from "drizzle-orm";

const BASE_URL = "https://thebasedreader.app";

export async function GET() {
  const userRows = await db.select({ username: users.username }).from(users).where(isNotNull(users.username));

  const urls = userRows
    .filter((u) => u.username)
    .map((u) => `  <url><loc>${BASE_URL}/u/${u.username}</loc><changefreq>weekly</changefreq><priority>0.4</priority></url>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
