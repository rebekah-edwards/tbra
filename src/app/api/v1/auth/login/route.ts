import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, createSession, NATIVE_SESSION_DURATION } from "@/lib/auth";
import { toPublicUser } from "@/lib/api/users";

/**
 * POST /api/v1/auth/login
 * Native-client login. Body: { email, password }.
 * Returns { token, user } — the JWT in the body (the iOS app stores it in the
 * Keychain), mirroring the web login's credential check exactly. Web login
 * (the server action) still sets a cookie; this endpoint does not.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof (body as Record<string, unknown>)?.email === "string"
    ? ((body as Record<string, string>).email).trim()
    : "";
  const password = typeof (body as Record<string, unknown>)?.password === "string"
    ? (body as Record<string, string>).password
    : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get();

  // Same generic message for missing user / no password / wrong password —
  // don't leak which emails exist.
  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = await createSession(
    user.id,
    user.email,
    user.emailVerified,
    NATIVE_SESSION_DURATION,
  );

  return NextResponse.json({ token, user: toPublicUser(user) });
}
