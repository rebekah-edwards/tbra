import { NextRequest, NextResponse } from "next/server";
import { listIndexableBooks, renderUrlset, SITEMAP_HEADERS } from "@/lib/seo/indexability";

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

  // Only the SEO core set (2026-11-16): books a reader has shelved or reviewed
  // whose page is complete. Everything else renders `noindex, follow` and is
  // deliberately absent here — see src/lib/seo/core-set.ts. The page count in
  // sitemap-index.xml comes from countIndexableBooks(), the same set.
  const entries = await listIndexableBooks(PER_PAGE, (pageNum - 1) * PER_PAGE);

  return new NextResponse(renderUrlset(BASE_URL, "/book/", entries), { headers: SITEMAP_HEADERS });
}
