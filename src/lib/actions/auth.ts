"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getCurrentUser,
} from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";

interface AuthState {
  error?: string;
  success?: boolean;
  redirectTo?: string;
}

/**
 * Generate a secure random token for email verification.
 */
function generateVerificationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signup(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get();

  if (existing) {
    return { error: "An account with this email already exists." };
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const verificationToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  await db.insert(users).values({
    id: userId,
    email: email.toLowerCase(),
    passwordHash,
    emailVerified: false,
    emailVerificationToken: verificationToken,
    emailVerificationExpiresAt: expiresAt,
  });

  // Send verification email (non-blocking — don't fail signup if email fails)
  const emailResult = await sendVerificationEmail(email.toLowerCase(), verificationToken);
  if (!emailResult.success) {
    console.error(`[auth] Failed to send verification email to ${email}:`, emailResult.error);
  }

  // Create session with verified=false so middleware gates access
  const token = await createSession(userId, email.toLowerCase(), false);
  await setSessionCookie(token);

  // Return success with redirect URL instead of server-side redirect.
  // This allows the client to do window.location.href which gives Safari's
  // password manager a chance to prompt "Save Password?" on navigation.
  return { success: true, redirectTo: "/verify-email" };
}

/**
 * Resend verification email for the current logged-in user.
 */
export async function resendVerificationEmail(): Promise<AuthState> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { error: "Not logged in." };
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, currentUser.userId))
    .get();

  if (!user) return { error: "User not found." };
  if (user.emailVerified) return { error: "Email is already verified." };

  const verificationToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db
    .update(users)
    .set({
      emailVerificationToken: verificationToken,
      emailVerificationExpiresAt: expiresAt,
    })
    .where(eq(users.id, currentUser.userId));

  const result = await sendVerificationEmail(user.email, verificationToken);
  if (!result.success) {
    return { error: "Failed to send email. Please try again." };
  }

  return {};
}

export async function login(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get();

  if (!user || !user.passwordHash) {
    return { error: "Invalid email or password." };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { error: "Invalid email or password." };
  }

  // Include verification status in session token
  const token = await createSession(user.id, user.email, user.emailVerified);
  await setSessionCookie(token);

  // Redirect unverified users to verification page
  if (!user.emailVerified) {
    redirect("/verify-email");
  }

  redirect("/");
}

export async function logout() {
  await clearSessionCookie();
  redirect("/");
}
