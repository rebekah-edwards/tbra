import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUser } from "@/lib/queries/profile";

export async function GET() {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUser(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    displayName: user.displayName,
    username: user.username,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    email: user.email,
    instagram: user.instagram,
    tiktok: user.tiktok,
    threads: user.threads,
    twitter: user.twitter,
    isPrivate: user.isPrivate,
  });
}
