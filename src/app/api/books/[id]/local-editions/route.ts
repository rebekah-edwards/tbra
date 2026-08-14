import { NextResponse } from "next/server";
import { getLocalEditions } from "@/lib/queries/local-editions";
import { resolveBook } from "@/lib/queries/books";

/**
 * GET /api/books/[id]/local-editions
 *
 * Printings folded onto this book at ingestion that OpenLibrary does not list
 * — deluxe, anniversary, signed, large-print. The edition picker merges these
 * with the live OL list so a reader can pick the exact printing they own even
 * when OL has never heard of it.
 *
 * Kept separate from /api/openlibrary/editions on purpose: that route is
 * paginated against OL's offsets, and folding extra entries into its `entries`
 * array would desync the picker's load-more offset arithmetic.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return NextResponse.json({ entries: [] }, { status: 404 });

  const entries = await getLocalEditions(resolved.book.id);
  return NextResponse.json({ entries });
}
