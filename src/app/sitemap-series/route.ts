import { NextResponse } from "next/server";
import { listIndexableSeries, renderUrlset, SITEMAP_HEADERS } from "@/lib/seo/indexability";

const BASE_URL = "https://thebasedreader.app";

// Series with at least CORE_GATE.minCoreBooksForListPage core books. Thinner
// series pages render `noindex, follow` (Google was filing them as soft 404s).
export async function GET() {
  const entries = await listIndexableSeries();
  return new NextResponse(renderUrlset(BASE_URL, "/series/", entries), { headers: SITEMAP_HEADERS });
}
