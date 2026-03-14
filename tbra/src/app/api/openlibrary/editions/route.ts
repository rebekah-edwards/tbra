import { NextRequest, NextResponse } from "next/server";
import { fetchWorkEditions } from "@/lib/openlibrary";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workKey = searchParams.get("workKey");
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  if (!workKey) {
    return NextResponse.json({ error: "workKey is required" }, { status: 400 });
  }

  const data = await fetchWorkEditions(workKey, limit, offset);
  return NextResponse.json(data);
}
