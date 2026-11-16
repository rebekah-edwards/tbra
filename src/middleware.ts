import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";

const COOKIE_NAME = "tbra-session";
// Keep in sync with SESSION_DURATION in src/lib/auth.ts (can't import it here —
// that module pulls in db/Drizzle, which the Edge runtime can't load).
const SESSION_DURATION = 60 * 24 * 60 * 60; // 60 days in seconds
// Re-issue the cookie when the token is older than this, so any visit from an
// active user rolls their session forward instead of dying at a fixed expiry.
const REFRESH_AFTER_SECONDS = 24 * 60 * 60; // 1 day

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

// ─── Real HTTP status codes for book / series / author URLs ───
// These pages stream (root loading.tsx puts everything under a Suspense
// boundary), so by the time the page calls notFound() or redirect() the 200
// status line has already gone out: a missing book answered "200 + noindex"
// and a merged book's old URL answered 200 with a client-side redirect —
// which Search Console files as soft 404s. Middleware runs before any byte is
// sent, so the existence check lives here. Edge runtime can't load Drizzle;
// this talks to Turso's HTTP API directly. Any failure or slow answer FAILS
// OPEN: the request continues to the page exactly as before.
const ENTITY_ROUTE = /^\/(book|series|author)\/([^/]+)\/?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_LOOKUP_TIMEOUT_MS = 1500;

type EntityVerdict = { kind: "pass" } | { kind: "missing" } | { kind: "moved"; to: string };

/** Run one statement against Turso over HTTP. Returns rows of nullable strings, or null if unavailable. */
async function tursoQuery(sql: string, args: string[]): Promise<(string | null)[][] | null> {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!dbUrl || !token) return null; // local dev (SQLite) — nothing to ask
  const res = await fetch(`${dbUrl.replace(/^libsql:\/\//, "https://")}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: args.map((value) => ({ type: "text", value })) } },
        { type: "close" },
      ],
    }),
    signal: AbortSignal.timeout(ENTITY_LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const first = data?.results?.[0];
  if (first?.type !== "ok") return null;
  const rows = first.response?.result?.rows;
  if (!Array.isArray(rows)) return null;
  return rows.map((row: { type: string; value?: string }[]) =>
    row.map((cell) => (cell.type === "null" || cell.value == null ? null : String(cell.value))),
  );
}

async function resolveEntity(kind: string, segment: string): Promise<EntityVerdict> {
  const table = kind === "book" ? "books" : kind === "series" ? "series" : "authors";

  if (UUID_PATTERN.test(segment)) {
    const rows = await tursoQuery(`SELECT slug FROM ${table} WHERE id = ? LIMIT 1`, [segment]);
    if (!rows) return { kind: "pass" };
    if (rows.length === 0) return { kind: "missing" };
    const slug = rows[0][0];
    // Slug-less rows are legitimately served at their UUID URL.
    return slug ? { kind: "moved", to: `/${kind}/${encodeURIComponent(slug)}` } : { kind: "pass" };
  }

  if (kind !== "book") {
    const rows = await tursoQuery(`SELECT 1 FROM ${table} WHERE slug = ? LIMIT 1`, [segment]);
    if (!rows) return { kind: "pass" };
    return rows.length > 0 ? { kind: "pass" } : { kind: "missing" };
  }

  // Books: a live slug wins; otherwise a retired slug (merge/rename) 301s to
  // the book it now belongs to — the same rule as resolveBook().
  const rows = await tursoQuery(
    `SELECT 'live' AS src, slug, id FROM books WHERE slug = ?
     UNION ALL
     SELECT 'old' AS src, b.slug, b.id FROM book_slug_history h JOIN books b ON b.id = h.book_id WHERE h.old_slug = ?`,
    [segment, segment],
  );
  if (!rows) return { kind: "pass" };
  if (rows.some((r) => r[0] === "live")) return { kind: "pass" };
  const old = rows.find((r) => r[0] === "old");
  if (!old) return { kind: "missing" };
  const target = old[1] || old[2];
  return target ? { kind: "moved", to: `/book/${encodeURIComponent(target)}` } : { kind: "missing" };
}

export async function middleware(request: NextRequest) {
  const { pathname, host, protocol } = request.nextUrl;

  // Full-page loads of an entity URL only: client-side (RSC) navigations and
  // prefetches keep the streamed not-found/redirect they have always had.
  const entity = ENTITY_ROUTE.exec(pathname);
  if (
    entity &&
    (request.method === "GET" || request.method === "HEAD") &&
    !request.headers.has("rsc") &&
    !request.headers.has("next-router-prefetch")
  ) {
    try {
      const verdict = await resolveEntity(entity[1], decodeURIComponent(entity[2]));
      if (verdict.kind === "moved") {
        return NextResponse.redirect(new URL(verdict.to, request.url), 301);
      }
      if (verdict.kind === "missing") {
        // An unmatched path renders the app's normal not-found page.
        return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
      }
    } catch {
      // Timeout / network / malformed segment — fall through to the page.
    }
  }

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

    // Rolling session: once the token is a day old, mint a fresh one on the
    // way through so active users never hit the fixed expiry.
    const issuedAt = typeof payload.iat === "number" ? payload.iat : 0;
    const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
    if (ageSeconds > REFRESH_AFTER_SECONDS && payload.userId) {
      const freshToken = await new SignJWT({
        userId: payload.userId,
        email: payload.email,
        verified: verified ?? true,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_DURATION}s`)
        .sign(secret);
      const response = NextResponse.next();
      response.cookies.set(COOKIE_NAME, freshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_DURATION,
        path: "/",
      });
      return response;
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
