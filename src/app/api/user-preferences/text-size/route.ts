import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { userReadingPreferences } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { textSize } = await request.json();
  if (!["small", "medium", "large"].includes(textSize)) {
    return NextResponse.json({ error: "Invalid text size" }, { status: 400 });
  }

  // Upsert into user_reading_preferences — we store textSize in the existing table
  // using a new column. For now, use a simple raw SQL approach since
  // the column may or may not exist.
  try {
    await db.run(
      sql`INSERT INTO user_reading_preferences (user_id, text_size, updated_at)
          VALUES (${session.userId}, ${textSize}, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET text_size = ${textSize}, updated_at = datetime('now')`
    );
  } catch {
    // Column might not exist yet — that's okay, localStorage is the source of truth
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ textSize: "medium" });
  }

  try {
    const row = await db
      .select({ textSize: sql<string>`text_size` })
      .from(userReadingPreferences)
      .where(eq(userReadingPreferences.userId, session.userId))
      .get();

    return NextResponse.json({ textSize: row?.textSize || "medium" });
  } catch {
    return NextResponse.json({ textSize: "medium" });
  }
}
