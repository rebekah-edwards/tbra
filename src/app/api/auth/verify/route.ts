import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createSession, setSessionCookie } from "@/lib/auth";

/**
 * GET /api/auth/verify?token=xxx
 *
 * Verifies a user's email address using the token from the verification link.
 * Refreshes the session cookie with verified=true so middleware stops gating.
 * Redirects to /onboarding on success or /verify-email?error=... on failure.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(
      new URL("/verify-email?error=missing-token", request.url)
    );
  }

  // Find user with this verification token
  const user = await db
    .select()
    .from(users)
    .where(eq(users.emailVerificationToken, token))
    .get();

  if (!user) {
    return NextResponse.redirect(
      new URL("/verify-email?error=invalid-token", request.url)
    );
  }

  // Check if token has expired
  if (
    user.emailVerificationExpiresAt &&
    new Date(user.emailVerificationExpiresAt) < new Date()
  ) {
    return NextResponse.redirect(
      new URL("/verify-email?error=expired-token", request.url)
    );
  }

  // Mark email as verified and clear the token
  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    })
    .where(eq(users.id, user.id));

  // Refresh session cookie with verified=true so middleware lets them through
  const sessionToken = await createSession(user.id, user.email, true);
  await setSessionCookie(sessionToken);

  // Redirect to onboarding (new users) or home (existing users)
  return NextResponse.redirect(new URL("/onboarding", request.url));
}
