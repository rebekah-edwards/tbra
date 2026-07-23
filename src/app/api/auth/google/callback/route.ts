import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, COOKIE_NAME, SESSION_DURATION, NATIVE_ACCESS_DURATION } from "@/lib/auth";
import { issueRefreshToken } from "@/lib/auth-refresh";
import { generateUniqueUsername } from "@/lib/username";

export const runtime = "nodejs";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function baseUrl(): string {
  return process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/** Native sessions get errors back on the tbra:// scheme so the auth sheet
 *  can close and surface the message instead of dead-ending on a web page. */
function fail(reason: string, isNative = false) {
  if (isNative) return NextResponse.redirect(`tbra://google-auth?error=${reason}`);
  return NextResponse.redirect(new URL(`/login?error=${reason}`, baseUrl()));
}

/**
 * GET /api/auth/google/callback — finish the Google OAuth flow.
 *
 * Account linking order (only ever auto-links on a Google-VERIFIED email, to
 * avoid account-takeover via an unverified address):
 *   1. existing account with this google_sub → sign in
 *   2. existing account with this (verified) email → link google_sub + sign in
 *   3. otherwise → create a new account (email pre-verified by Google)
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // Set by /api/auth/google?native=1 (iOS ASWebAuthenticationSession).
  const isNative = req.cookies.get("g_oauth_native")?.value === "1";

  if (oauthError) return fail("google_denied", isNative);
  if (!code || !state) return fail("google_invalid", isNative);

  // CSRF: state param must match the cookie set at initiation.
  const cookieState = req.cookies.get("g_oauth_state")?.value;
  if (!cookieState || cookieState !== state) return fail("google_state", isNative);

  const redirectToCookie = req.cookies.get("g_oauth_redirect")?.value;
  const redirectTo = redirectToCookie && redirectToCookie.startsWith("/") ? redirectToCookie : "/";

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("google_unconfigured", isNative);

  try {
    // 1. Exchange the authorization code for tokens.
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${baseUrl()}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      console.error("[google] token exchange failed:", tokenRes.status, await tokenRes.text());
      return fail("google_token", isNative);
    }
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) return fail("google_token", isNative);

    // 2. Verify the ID token (signature, issuer, audience).
    const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });

    const sub = payload.sub;
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    const name = typeof payload.name === "string" ? payload.name : null;
    const picture = typeof payload.picture === "string" ? payload.picture : null;
    if (!sub) return fail("google_token", isNative);

    // 3. Resolve the account.
    let userId: string | null = null;
    let userEmail: string | null = null;
    let isNew = false;

    const byGoogle = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.googleSub, sub))
      .get();

    if (byGoogle) {
      userId = byGoogle.id;
      userEmail = byGoogle.email;
    } else if (email && emailVerified) {
      const byEmail = await db
        .select({ id: users.id, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.email, email))
        .get();
      if (byEmail) {
        // Link Google to the existing email/password account.
        await db
          .update(users)
          .set({ googleSub: sub, emailVerified: true, avatarUrl: byEmail.avatarUrl ?? picture })
          .where(eq(users.id, byEmail.id));
        userId = byEmail.id;
        userEmail = byEmail.email;
      }
    }

    if (!userId) {
      // 4. Create a new account. Require a Google-verified email.
      if (!email || !emailVerified) return fail("google_unverified", isNative);
      const newId = crypto.randomUUID();
      const username = await generateUniqueUsername(email);
      try {
        await db.insert(users).values({
          id: newId,
          email,
          username,
          googleSub: sub,
          emailVerified: true,
          displayName: name,
          avatarUrl: picture,
        });
      } catch (err) {
        // Race: an account with this email was just created. Link instead.
        console.warn("[google] insert race, linking by email:", err);
        const existing = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).get();
        if (!existing) return fail("google_create", isNative);
        await db.update(users).set({ googleSub: sub, emailVerified: true }).where(eq(users.id, existing.id));
        userId = existing.id;
        userEmail = existing.email;
      }
      if (!userId) {
        userId = newId;
        userEmail = email;
        isNew = true;
      }
    }

    // 5. Mint the session and set it on the redirect response.
    if (isNative) {
      // iOS: hand the native token pair back through the custom scheme; the
      // ASWebAuthenticationSession intercepts it and stores both in Keychain.
      const accessToken = await createSession(userId, userEmail!, true, NATIVE_ACCESS_DURATION);
      const refreshToken = await issueRefreshToken(userId);
      const params = new URLSearchParams({ token: accessToken, refresh: refreshToken });
      if (isNew) params.set("new", "1");
      const res = NextResponse.redirect(`tbra://google-auth?${params.toString()}`);
      res.cookies.delete("g_oauth_state");
      res.cookies.delete("g_oauth_redirect");
      res.cookies.delete("g_oauth_native");
      return res;
    }
    const token = await createSession(userId, userEmail!, true);
    const dest = isNew ? "/onboarding" : redirectTo;
    const res = NextResponse.redirect(new URL(dest, baseUrl()));
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_DURATION,
      path: "/",
    });
    res.cookies.delete("g_oauth_state");
    res.cookies.delete("g_oauth_redirect");
    return res;
  } catch (err) {
    console.error("[google] callback error:", err);
    return fail("google_failed", isNative);
  }
}
