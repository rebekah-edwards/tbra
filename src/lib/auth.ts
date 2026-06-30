import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const COOKIE_NAME = "tbra-session";
export const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is required");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(
  userId: string,
  email: string,
  verified = true
): Promise<string> {
  return new SignJWT({ userId, email, verified })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(getSecret());
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export type AccountType = "reader" | "premium" | "beta_tester" | "admin" | "super_admin";

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  accountType: AccountType;
}

/**
 * Verify a raw session JWT and hydrate the AuthUser (role + accountType from DB).
 * Shared by the cookie reader (web) and the bearer-token reader (native API).
 * Returns null on any invalid/expired token.
 */
export async function verifySessionToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = payload.userId as string;

    // Fetch role + accountType from DB
    const user = await db
      .select({ role: users.role, accountType: users.accountType })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    return {
      userId,
      email: payload.email as string,
      role: user?.role ?? "user",
      accountType: (user?.accountType as AccountType) ?? "reader",
    };
  } catch {
    return null;
  }
}

/**
 * Web session reader: validates the session cookie. Behavior unchanged —
 * returns the current user, or null if there is no valid cookie.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * API session reader for native clients (and any request-scoped caller).
 * Prefers an `Authorization: Bearer <jwt>` header (how the iOS app authenticates),
 * falling back to the session cookie so the same routes also work from the web.
 */
export async function getApiUser(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) return verifySessionToken(token);
  }
  // No bearer token — fall back to the cookie (web fetches hitting these routes).
  return getCurrentUser();
}

/** Check if user has admin or super_admin access */
export function isAdmin(user: { role?: string; accountType?: string } | null): boolean {
  if (!user) return false;
  // Check accountType first (new), fall back to role (legacy)
  if (user.accountType) {
    return user.accountType === "admin" || user.accountType === "super_admin";
  }
  return user.role === "admin";
}

/** Check if user is super_admin (can manage other admins) */
export function isSuperAdmin(user: { accountType?: string } | null): boolean {
  return user?.accountType === "super_admin";
}

/** Check if user has premium access (premium, beta_tester, admin, super_admin) */
export function hasPremiumAccess(user: { accountType?: string } | null): boolean {
  if (!user?.accountType) return false;
  return ["premium", "beta_tester", "admin", "super_admin"].includes(user.accountType);
}

/** Alias for hasPremiumAccess — use in feature gates */
export const isPremium = hasPremiumAccess;

/** Check if user is a beta tester */
export function isBetaTester(user: { accountType?: string } | null): boolean {
  return user?.accountType === "beta_tester";
}
