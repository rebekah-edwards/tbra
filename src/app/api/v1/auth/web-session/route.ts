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
  // Redirect to the host THE CLIENT called, not url.origin — behind the dev
  // proxy url.origin is always localhost:3000, which sent the phone's
  // webview (reaching us via the Tailscale IP) to its own localhost: an
  // eternal black screen (found 2026-07-12).
  const host = req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return NextResponse.redirect(`${proto}://${host}${safeNext}`);
}
