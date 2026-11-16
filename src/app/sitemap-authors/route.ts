import { NextResponse } from "next/server";
import { listIndexableAuthors, renderUrlset, SITEMAP_HEADERS } from "@/lib/seo/indexability";

const BASE_URL = "https://thebasedreader.app";

// Authors with a slug and at least CORE_GATE.minCoreBooksForListPage core
// books. Slug-less authors (UUID URLs) and merged authors whose URL redirects
// are never listed.
export async function GET() {
  const entries = await listIndexableAuthors();
  return new NextResponse(renderUrlset(BASE_URL, "/author/", entries), { headers: SITEMAP_HEADERS });
}
