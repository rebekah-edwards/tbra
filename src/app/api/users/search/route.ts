import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { like, or, ne, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getHiddenUserIds } from "@/lib/queries/blocks";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const currentUser = await getCurrentUser();
  const pattern = `%${q}%`;

  const conditions = [
    or(
      like(users.displayName, pattern),
      like(users.username, pattern)
    ),
  ];

  // Exclude current user from results
  if (currentUser) {
    conditions.push(ne(users.id, currentUser.userId));
  }

  const results = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
    })
    .from(users)
    .where(and(...conditions))
    .limit(20)
    .all();

  // Blocks: never surface a reader the viewer blocked, or who blocked them.
  const hidden = await getHiddenUserIds(currentUser?.userId);
  return NextResponse.json(hidden.size === 0 ? results : results.filter((r) => !hidden.has(r.id)));
}
