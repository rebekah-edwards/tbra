import { NextResponse } from "next/server";
import { verifySessionToken, setSessionCookie } from "@/lib/auth";

/**
 * GET /api/v1/auth/web-session?token=<jwt>&next=<relative path>
 *
 * Bridge for the native app's in-app webviews (Admin, cover picker): turns
 * the app's bearer token into the web session cookie SERVER-SIDE, then
 * redirects to `next`. Client-side cookie injection via WKHTTPCookieStore
 * proved unreliable when the host is a raw IP (the phone reaches the dev
 * server over Tailscale), which left the webview signed out — the server's
 * own Set-Cookie always sticks.
 *
 * The token is the same jose JWT the cookie carries, and it already travels
 * to this server in headers on every API call; `next` is constrained to
 * relative paths to prevent open redirects.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const next = url.searchParams.get("next") ?? "/";

  const user = await verifySessionToken(token);
  if (!user) {
    return NextResponse.json({ error: "Invalid session token." }, { status: 401 });
  }

  // Relative-path-only redirect target ("/x" but not "//host/x").
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  await setSessionCookie(token);
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
