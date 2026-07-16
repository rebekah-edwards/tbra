import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { revokeRefreshToken, revokeAllForUser } from "@/lib/auth-refresh";

/**
 * POST /api/v1/auth/logout  { refreshToken?, all? }
 * - Default: revoke the provided refresh token (log out this device).
 * - { all: true }: revoke every refresh token for the authenticated user
 *   ("log out everywhere") — requires a valid access token.
 * Always returns { ok: true } (idempotent; never reveals token validity).
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // Empty/invalid body is fine — treated as a no-op logout.
  }

  if (body.all === true) {
    const user = await getApiUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    await revokeAllForUser(user.userId);
    return NextResponse.json({ ok: true });
  }

  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  return NextResponse.json({ ok: true });
}
