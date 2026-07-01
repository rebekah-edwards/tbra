import { NextResponse } from "next/server";
import { createSession, NATIVE_ACCESS_DURATION } from "@/lib/auth";
import { rotateRefreshToken } from "@/lib/auth-refresh";
import { fetchPublicUser } from "@/lib/api/users";

/**
 * POST /api/v1/auth/refresh  { refreshToken }
 * Swap a valid refresh token for a fresh access token + a new refresh token
 * (rotation). The old refresh token is revoked. 401 if the presented token is
 * unknown, already used/revoked, or expired.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const refreshToken = typeof (body as Record<string, unknown>)?.refreshToken === "string"
    ? (body as Record<string, string>).refreshToken
    : "";
  if (!refreshToken) {
    return NextResponse.json({ error: "refreshToken is required." }, { status: 400 });
  }

  const rotated = await rotateRefreshToken(refreshToken);
  if (!rotated) {
    return NextResponse.json({ error: "Invalid or expired refresh token." }, { status: 401 });
  }

  const user = await fetchPublicUser(rotated.userId);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired refresh token." }, { status: 401 });
  }

  const token = await createSession(
    user.id,
    user.email,
    user.emailVerified,
    NATIVE_ACCESS_DURATION,
  );

  return NextResponse.json({ token, refreshToken: rotated.refreshToken });
}
