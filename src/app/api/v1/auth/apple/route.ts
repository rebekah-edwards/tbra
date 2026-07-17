import { NextResponse } from "next/server";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, NATIVE_ACCESS_DURATION } from "@/lib/auth";
import { issueRefreshToken } from "@/lib/auth-refresh";
import { generateUniqueUsername } from "@/lib/username";
import { toPublicUser } from "@/lib/api/users";

export const runtime = "nodejs";

const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
/** The native app's bundle id — the audience Apple signs identity tokens for. */
const APPLE_AUDIENCE = "app.tbra.ios";

/**
 * POST /api/v1/auth/apple — native Sign in with Apple.
 * Body: { identityToken, fullName? } — identityToken comes straight from
 * ASAuthorizationAppleIDCredential; we verify it against Apple's JWKS (no
 * client secret needed for the native flow). Account linking mirrors the
 * Google callback: apple_sub match → sign in; verified-email match → link;
 * else create (Apple emails are verified, incl. private-relay addresses).
 * fullName is only delivered by Apple on the FIRST authorization, so the
 * client passes it along for account creation.
 */
export async function POST(req: Request) {
  let body: { identityToken?: string; fullName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  if (!body.identityToken || typeof body.identityToken !== "string") {
    return NextResponse.json({ error: "identityToken is required." }, { status: 400 });
  }

  let sub: string, email: string | null, emailVerified: boolean;
  try {
    const { payload } = await jwtVerify(body.identityToken, APPLE_JWKS, {
      issuer: "https://appleid.apple.com",
      audience: APPLE_AUDIENCE,
    });
    sub = payload.sub as string;
    email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    emailVerified = payload.email_verified === true || payload.email_verified === "true";
    if (!sub) throw new Error("no sub");
  } catch {
    return NextResponse.json({ error: "Invalid Apple token." }, { status: 401 });
  }

  const name = typeof body.fullName === "string" && body.fullName.trim() ? body.fullName.trim() : null;

  let userId: string | null = null;
  const bySub = await db.select({ id: users.id }).from(users).where(eq(users.appleSub, sub)).get();
  if (bySub) {
    userId = bySub.id;
  } else if (email && emailVerified) {
    const byEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
    if (byEmail) {
      await db.update(users).set({ appleSub: sub, emailVerified: true }).where(eq(users.id, byEmail.id));
      userId = byEmail.id;
    }
  }

  if (!userId) {
    if (!email) return NextResponse.json({ error: "Apple did not provide an email." }, { status: 400 });
    const newId = crypto.randomUUID();
    const username = await generateUniqueUsername(email);
    try {
      await db.insert(users).values({
        id: newId,
        email,
        username,
        appleSub: sub,
        emailVerified: true,
        displayName: name,
      });
      userId = newId;
    } catch {
      // Race: account with this email appeared — link instead.
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
      if (!existing) return NextResponse.json({ error: "Could not create account." }, { status: 500 });
      await db.update(users).set({ appleSub: sub, emailVerified: true }).where(eq(users.id, existing.id));
      userId = existing.id;
    }
  }

  const row = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) return NextResponse.json({ error: "Account lookup failed." }, { status: 500 });

  const token = await createSession(userId, row.email, true, NATIVE_ACCESS_DURATION);
  const refreshToken = await issueRefreshToken(userId);
  return NextResponse.json({ token, refreshToken, user: toPublicUser(row) });
}
