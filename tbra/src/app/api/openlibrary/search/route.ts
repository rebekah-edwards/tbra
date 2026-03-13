import { NextRequest, NextResponse } from "next/server";
import { searchOpenLibrary } from "@/lib/openlibrary";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }
  const results = await searchOpenLibrary(q.trim());
  return NextResponse.json(results);
}
