import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, userNotifications } from "@/db/schema";
import { hashPassword, createSession, NATIVE_ACCESS_DURATION } from "@/lib/auth";

/** Same generator as the web signup action (private there). */
function generateVerificationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
import { issueRefreshToken } from "@/lib/auth-refresh";
import { toPublicUser } from "@/lib/api/users";
import { sendVerificationEmail } from "@/lib/email";
import { lookupReferralCode } from "@/lib/referrals";

/**
 * POST /api/v1/auth/register — native signup. Body: { email, password,
 * referralCode? }. Mirrors the web signup action step-for-step (dedup,
 * username autogen from the email prefix, referral credit + notification,
 * verification email) but returns the native token pair instead of a
 * cookie session.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const referralCode = typeof body.referralCode === "string" && body.referralCode.trim()
    ? body.referralCode.trim() : null;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get();
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const verificationToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Auto-generate username from email prefix (same rules as web signup)
  let username: string | null = null;
  try {
    const emailPrefix = email.toLowerCase().split("@")[0].replace(/[^a-z0-9_]/g, "").slice(0, 20);
    if (emailPrefix.length >= 3) {
      const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, emailPrefix)).get();
      if (!taken) {
        username = emailPrefix;
      } else {
        for (let i = 0; i < 3; i++) {
          const candidate = `${emailPrefix.slice(0, 17)}${Math.floor(100 + Math.random() * 900)}`;
          const clash = await db.select({ id: users.id }).from(users).where(eq(users.username, candidate)).get();
          if (!clash) { username = candidate; break; }
        }
      }
    }
  } catch { /* proceed without username */ }

  let referredByUserId: string | null = null;
  if (referralCode) {
    const referrer = await lookupReferralCode(referralCode);
    if (referrer) referredByUserId = referrer.userId;
  }

  try {
    await db.insert(users).values({
      id: userId,
      email: email.toLowerCase(),
      username,
      passwordHash,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpiresAt: expiresAt,
      referredByUserId,
    });
  } catch (err) {
    console.error("[v1/register] insert failed:", err);
    return NextResponse.json({ error: "Something went wrong creating your account." }, { status: 500 });
  }

  if (referredByUserId) {
    const newUserName = username ? `@${username}` : email.split("@")[0];
    try {
      await db.insert(userNotifications).values({
        userId: referredByUserId,
        type: "referral_signup",
        title: "New referral!",
        message: `${newUserName} joined tbr*a through your referral link`,
        linkUrl: "/profile/referrals",
      });
    } catch { /* non-blocking */ }
  }

  const emailResult = await sendVerificationEmail(email.toLowerCase(), verificationToken);
  if (!emailResult.success) {
    console.error(`[v1/register] verification email failed for ${email}:`, emailResult.error);
  }

  const token = await createSession(userId, email.toLowerCase(), false, NATIVE_ACCESS_DURATION);
  const refreshToken = await issueRefreshToken(userId);
  const row = await db.select().from(users).where(eq(users.id, userId)).get();

  return NextResponse.json({ token, refreshToken, user: row ? toPublicUser(row) : null });
}
