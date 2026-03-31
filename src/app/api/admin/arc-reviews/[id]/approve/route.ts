import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { userBookReviews } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await db
    .update(userBookReviews)
    .set({ arcStatus: "approved", updatedAt: new Date().toISOString() })
    .where(eq(userBookReviews.id, id));

  return NextResponse.json({ success: true });
}
