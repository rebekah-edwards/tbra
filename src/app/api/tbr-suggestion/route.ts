import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRandomOwnedTbrBook } from "@/lib/queries/tbr-suggestion";

export async function GET() {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const book = await getRandomOwnedTbrBook(session.userId);
  return NextResponse.json(book);
}
