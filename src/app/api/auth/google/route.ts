import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// Canonical site origin (apex — NOT www). Used to build the OAuth redirect_uri
// so it matches the registered URI and keeps the whole flow on one domain.
function baseUrl(): string {
  return process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * GET /api/auth/google — start the Google OAuth 2.0 Authorization Code flow.
 * Sets a short-lived CSRF `state` cookie (verified in the callback) and an
 * optional post-login `redirectTo`, then redirects to Google's consent screen.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=google_unconfigured", baseUrl()));
  }

  const state = crypto.randomUUID();
  const redirectTo = req.nextUrl.searchParams.get("redirectTo") || "/";
  // Native app (ASWebAuthenticationSession): the callback returns the token
  // pair via a tbra:// redirect instead of setting the web session cookie.
  const isNative = req.nextUrl.searchParams.get("native") === "1";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl()}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });

  const res = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 600, // 10 min — just long enough to complete consent
    path: "/",
  };
  res.cookies.set("g_oauth_state", state, cookieOpts);
  // Only allow internal relative redirects to avoid open-redirect abuse.
  res.cookies.set("g_oauth_redirect", redirectTo.startsWith("/") ? redirectTo : "/", cookieOpts);
  if (isNative) res.cookies.set("g_oauth_native", "1", cookieOpts);
  return res;
}
