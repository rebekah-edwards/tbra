import { NextResponse } from "next/server";
import { healBatch, healBook } from "@/lib/enrichment/heal";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/enrichment/heal
 *
 * Run the healing pass on a batch of books.
 * Safe to re-run — idempotent per book.
 *
 * Query params:
 *   limit — max books to process (default 50, max 200)
 *   bookId — heal a single specific book instead of a batch
 */
export async function POST(request: Request) {
  const host = request.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const user = await getCurrentUser();
  const localSecret = request.headers.get("x-enrichment-secret");
  const isLocalAuthed = localSecret === process.env.ENRICHMENT_SECRET;

  if (!isLocalhost && !isLocalAuthed && (!user || user.role !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const bookId = searchParams.get("bookId");

  if (bookId) {
    // Single-book mode
    const result = await healBook(bookId);
    return NextResponse.json(result);
  }

  // Batch mode
  const limit = Math.min(200, parseInt(searchParams.get("limit") ?? "50", 10));
  const results = await healBatch({ limit });

  const totalFixes = results.reduce((sum, r) => sum + r.fixes.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const booksWithFixes = results.filter((r) => r.fixes.length > 0);

  return NextResponse.json({
    processed: results.length,
    totalFixes,
    totalErrors,
    booksWithFixes: booksWithFixes.map((r) => ({
      title: r.title,
      fixes: r.fixes,
      errors: r.errors,
    })),
  });
}
