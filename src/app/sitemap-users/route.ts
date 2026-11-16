import { NextResponse } from "next/server";
import { renderUrlset, SITEMAP_HEADERS } from "@/lib/seo/indexability";

// Public profiles are thin pages, so none are submitted (2026-11-16). The
// route stays, returning a valid empty sitemap, because this URL was submitted
// to Search Console on its own and a 404 there shows up as a sitemap error.
export async function GET() {
  return new NextResponse(renderUrlset("https://thebasedreader.app", "/u/", []), { headers: SITEMAP_HEADERS });
}
