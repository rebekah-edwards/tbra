/**
 * Refresh-token rotation for the native app's "never log out" experience.
 *
 * The access token (a short-lived JWT, see NATIVE_ACCESS_DURATION) is what the
 * app sends on every request. When it expires, the app posts its refresh token
 * to /api/v1/auth/refresh to get a fresh access token + a NEW refresh token.
 *
 * Security properties:
 * - Only the SHA-256 hash of each refresh token is stored. The raw token is a
 *   256-bit random string handed to the client once; a DB leak can't be
 *   replayed.
 * - Rotation on use: presenting a refresh token revokes it and issues a new
 *   one, so a stolen token is usable at most once before the legitimate client
 *   invalidates it.
 * - Server-side revocation: logout (and "log out everywhere") flip revokedAt,
 *   which stateless JWTs can't offer on their own.
 */
import crypto from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { authRefreshTokens } from "@/db/schema";

export const REFRESH_TOKEN_TTL_DAYS = 60;

function sha256(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Mint a new refresh token for a user; returns the raw token (store the hash). */
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = generateRawToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000).toISOString();
  await db.insert(authRefreshTokens).values({
    userId,
    tokenHash: sha256(raw),
    expiresAt,
  });
  return raw;
}

/**
 * Validate a presented refresh token and rotate it: the old token is revoked
 * and a new one issued. Returns { userId, refreshToken } on success, or null if
 * the token is unknown, already revoked, or expired.
 */
export async function rotateRefreshToken(
  raw: string,
): Promise<{ userId: string; refreshToken: string } | null> {
  const row = await db
    .select()
    .from(authRefreshTokens)
    .where(eq(authRefreshTokens.tokenHash, sha256(raw)))
    .get();

  if (!row) return null;
  if (row.revokedAt) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;

  const now = new Date().toISOString();
  await db
    .update(authRefreshTokens)
    .set({ revokedAt: now, lastUsedAt: now })
    .where(eq(authRefreshTokens.id, row.id));

  const refreshToken = await issueRefreshToken(row.userId);
  return { userId: row.userId, refreshToken };
}

/** Revoke a single refresh token (logout on one device). Idempotent. */
export async function revokeRefreshToken(raw: string): Promise<void> {
  await db
    .update(authRefreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(authRefreshTokens.tokenHash, sha256(raw)), isNull(authRefreshTokens.revokedAt)));
}

/** Revoke every active refresh token for a user ("log out everywhere"). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await db
    .update(authRefreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(authRefreshTokens.userId, userId), isNull(authRefreshTokens.revokedAt)));
}
