import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { getUserUpNext } from "@/lib/queries/up-next";

/**
 * GET /api/v1/up-next
 * The signed-in user's Up Next queue (max 6), already ordered by position.
 * Reuses the existing query fn used by the web library page.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const items = await getUserUpNext(user.userId);
  return NextResponse.json({ items });
}
