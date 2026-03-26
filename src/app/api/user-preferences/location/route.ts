import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await db
    .select({ location: users.location, locationVisibility: users.locationVisibility })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();

  return NextResponse.json({
    location: row?.location || "",
    locationVisibility: row?.locationVisibility || "public",
  });
}

export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { location, locationVisibility } = await request.json();

  if (typeof location !== "string" || location.length > 100) {
    return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  }

  if (!["public", "followers"].includes(locationVisibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  await db
    .update(users)
    .set({
      location: location || null,
      locationVisibility,
    })
    .where(eq(users.id, session.userId));

  return NextResponse.json({ ok: true });
}
