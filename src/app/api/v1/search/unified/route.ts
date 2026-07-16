import { NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { searchSeriesMeilisearch, searchAuthorsMeilisearch } from "@/lib/search/meilisearch";

/**
 * GET /api/v1/search/unified?q= — grouped results for the native FLOATING
 * search overlay (web nav search-bar.tsx parity): books via the existing
 * v1 book search + series/authors via Meilisearch, with a simple
 * sectionOrder (exact series/author name match ranks its section first).
 * The overlay's footer routes to the full search page, which handles the
 * ISBNdb external supplement — so `external` is intentionally omitted here.
 */
export async function GET(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return jsonOk({ books: [], series: [], authors: [], sectionOrder: ["books"] });

  // Books: call the sibling v1 route's handler directly (same auth header).
  const booksReq = new Request(
    new URL(`/api/v1/search?q=${encodeURIComponent(q)}&limit=8`, req.url),
    { headers: req.headers },
  );
  const { GET: booksGET } = await import("../route");
  const [booksRes, seriesRaw, authorsRaw] = await Promise.all([
    booksGET(booksReq as NextRequest).then((r) => r.json()).catch(() => ({ results: [] })),
    searchSeriesMeilisearch(q, 3).catch(() => []),
    searchAuthorsMeilisearch(q, 3).catch(() => []),
  ]);

  const qLower = q.toLowerCase();
  const sectionOrder: string[] = [];
  if (seriesRaw.some((s: { name: string }) => s.name.toLowerCase().startsWith(qLower))) sectionOrder.push("series");
  if (authorsRaw.some((a: { name: string }) => a.name.toLowerCase().startsWith(qLower))) sectionOrder.push("authors");
  for (const s of ["books", "series", "authors"]) if (!sectionOrder.includes(s)) sectionOrder.push(s);

  return jsonOk({
    books: booksRes.results ?? [],
    series: seriesRaw,
    authors: authorsRaw,
    sectionOrder,
  });
}
