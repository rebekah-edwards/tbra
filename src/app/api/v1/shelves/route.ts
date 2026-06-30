import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { getUserShelves } from "@/lib/queries/shelves";

/**
 * GET /api/v1/shelves
 * All of the signed-in user's shelves (summaries with book counts + mosaic
 * cover URLs), ordered by position. Reuses the web query fn.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const shelves = await getUserShelves(user.userId);
  return NextResponse.json({ shelves });
}
