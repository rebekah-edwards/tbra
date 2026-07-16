import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { fetchPublicUser } from "@/lib/api/users";

/**
 * GET /api/v1/auth/me
 * Validates the bearer token and returns the current user. The iOS app calls
 * this on launch to confirm a stored token is still valid before showing the
 * signed-in UI. Returns 401 for a missing/expired/invalid token.
 */
export async function GET(req: Request) {
  const authUser = await getApiUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const user = await fetchPublicUser(authUser.userId);
  if (!user) {
    // Token verified but the account no longer exists.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ user });
}
