import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSimilarBooks } from "@/lib/queries/recommendations";

/**
 * GET /api/books/similar?bookId=xxx
 *
 * Returns books similar to the given book, personalized for the current user.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bookId = searchParams.get("bookId");

  if (!bookId) {
    return NextResponse.json({ error: "bookId required" }, { status: 400 });
  }

  const user = await getCurrentUser();
  const results = await getSimilarBooks(bookId, user?.userId ?? null);

  return NextResponse.json(results);
}
