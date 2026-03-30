import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "tbra-session";

/**
 * Lightweight middleware to redirect unverified users to the verify-email page.
 *
 * We can't import db or Drizzle here (Edge runtime), so we decode the JWT
 * and check a `verified` claim. The claim is set at session creation time
 * and refreshed when the user verifies.
 */

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

// Routes that unverified users ARE allowed to access
const UNVERIFIED_ALLOWED = new Set([
  "/verify-email",
  "/api/auth/verify",
  "/login",
  "/signup",
  "/api/auth",
  "/methodology",
]);

// Prefixes that should always pass through (static assets, API routes, etc.)
const PASS_THROUGH_PREFIXES = [
  "/_next",
  "/favicon",
  "/uploads",
  "/api/",
];

export async function middleware(request: NextRequest) {
  const { pathname, host, protocol } = request.nextUrl;

  // Redirect /defaultsite → /
  if (pathname === "/defaultsite") {
    return NextResponse.redirect(new URL("/", request.url), 301);
  }

  // Always allow static assets and auth API routes
  if (PASS_THROUGH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Always allow explicitly permitted routes
  if (UNVERIFIED_ALLOWED.has(pathname)) {
    return NextResponse.next();
  }

  // No session cookie → not logged in, let the page handle its own redirect
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.next();

  const secret = getSecret();
  if (!secret) return NextResponse.next();

  try {
    const { payload } = await jwtVerify(token, secret);
    const verified = payload.verified as boolean | undefined;

    // If the token has verified=false, redirect to verify-email
    // (verified=undefined means legacy token from before this feature — treat as verified
    // so existing users aren't locked out)
    if (verified === false) {
      return NextResponse.redirect(new URL("/verify-email", request.url));
    }
  } catch {
    // Invalid/expired token — let the page handle it
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
