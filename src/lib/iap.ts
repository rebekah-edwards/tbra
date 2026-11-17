import { X509Certificate } from "node:crypto";
import { compactVerify } from "jose";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Apple In-App Purchase — server side.
 *
 * The iOS app sells Based Reader as auto-renewable subscriptions (StoreKit 2).
 * The server, not the app, decides who is premium:
 *   • the app posts each transaction's signed JWS to POST /api/v1/iap/sync
 *   • Apple posts renewals, expiries and refunds to POST /api/iap/notifications
 * Both arrive as JWS signed by Apple. `verifyAppleJws` checks the signature
 * and the certificate chain up to Apple Root CA - G3 before a single field is
 * trusted — without that, anyone could mint themselves a subscription.
 *
 * Premium has two possible billers, Apple and Stripe (web). `premium_source`
 * records which one made an account premium so that one biller's
 * cancellation can never downgrade the other's subscriber.
 */

export const APPLE_BUNDLE_ID = "app.tbra.ios";
export const APPLE_PRODUCT_IDS = new Set([
  "app.tbra.ios.basedreader.monthly",
  "app.tbra.ios.basedreader.yearly",
]);

/** Apple Root CA - G3 (expires 2039-04-30), exported from the macOS system
 *  roots. SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79 */
const APPLE_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

// Apple marker extensions (DER-encoded OIDs), required on the chain so that
// only App Store receipt-signing certificates are accepted — not any other
// certificate Apple has ever issued under this root.
const OID_APPLE_INTERMEDIATE = Buffer.from("060a2a864886f76364060201", "hex"); // 1.2.840.113635.100.6.2.1
const OID_APPLE_RECEIPT_LEAF = Buffer.from("060a2a864886f76364060b01", "hex"); // 1.2.840.113635.100.6.11.1

function withinValidity(cert: X509Certificate, at: Date): boolean {
  return new Date(cert.validFrom) <= at && at <= new Date(cert.validTo);
}

/**
 * Verify an Apple-signed JWS and return its decoded payload.
 * Throws on any failure.
 */
export async function verifyAppleJws<T = Record<string, unknown>>(jws: string): Promise<T> {
  const [headerB64] = jws.split(".");
  if (!headerB64) throw new Error("Malformed JWS");
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as { alg?: string; x5c?: string[] };
  if (header.alg !== "ES256") throw new Error("Unexpected JWS algorithm");
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2) throw new Error("JWS has no certificate chain");

  const leaf = new X509Certificate(Buffer.from(x5c[0], "base64"));
  const intermediate = new X509Certificate(Buffer.from(x5c[1], "base64"));
  const root = new X509Certificate(APPLE_ROOT_CA_G3);

  const now = new Date();
  if (!withinValidity(leaf, now) || !withinValidity(intermediate, now)) throw new Error("Apple certificate expired");
  if (!leaf.verify(intermediate.publicKey)) throw new Error("Leaf certificate not signed by intermediate");
  if (!intermediate.verify(root.publicKey)) throw new Error("Intermediate not signed by Apple Root CA G3");
  if (!leaf.raw.includes(OID_APPLE_RECEIPT_LEAF)) throw new Error("Leaf is not an App Store signing certificate");
  if (!intermediate.raw.includes(OID_APPLE_INTERMEDIATE)) throw new Error("Intermediate is not an Apple WWDR certificate");

  const { payload } = await compactVerify(jws, leaf.publicKey);
  return JSON.parse(Buffer.from(payload).toString("utf8")) as T;
}

/** The fields of a StoreKit 2 / App Store Server `JWSTransaction` we use. */
export interface AppleTransaction {
  bundleId: string;
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  /** ms since epoch; absent for non-subscriptions. */
  expiresDate?: number;
  revocationDate?: number;
  /** The tbr*a user id the app attached at purchase time. */
  appAccountToken?: string;
  environment?: string;
  type?: string;
}

export function isAppleTransactionActive(tx: AppleTransaction, at = Date.now()): boolean {
  if (tx.revocationDate) return false;
  return typeof tx.expiresDate === "number" && tx.expiresDate > at;
}

interface UserRow {
  id: string;
  account_type: string;
  premium_source: string | null;
  apple_original_transaction_id: string | null;
}

export type ApplyResult =
  | { ok: true; userId: string; active: boolean; accountType: string }
  | { ok: false; reason: "no-user" | "wrong-app" | "unknown-product" | "belongs-to-another-account" };

/**
 * Apply a VERIFIED Apple transaction to an account.
 *
 * `claimedByUserId` is the signed-in reader when the app is syncing its own
 * purchase; omit it for Apple's server notifications, where the account is
 * found from the appAccountToken or the stored original transaction id.
 *
 * Only 'reader' ⇄ 'premium' ever flips (same rule as the Stripe webhook):
 * beta testers and staff keep their tier whatever Apple says.
 */
export async function applyAppleTransaction(tx: AppleTransaction, claimedByUserId?: string): Promise<ApplyResult> {
  if (tx.bundleId !== APPLE_BUNDLE_ID) return { ok: false, reason: "wrong-app" };
  if (!APPLE_PRODUCT_IDS.has(tx.productId)) return { ok: false, reason: "unknown-product" };

  const token = tx.appAccountToken?.toLowerCase() ?? null;

  // One Apple subscription unlocks one tbr*a account.
  if (claimedByUserId) {
    if (token && token !== claimedByUserId.toLowerCase()) return { ok: false, reason: "belongs-to-another-account" };
    const holder = (await db.all(sql`
      SELECT id FROM users WHERE apple_original_transaction_id = ${tx.originalTransactionId} AND id != ${claimedByUserId}
    `)) as { id: string }[];
    if (holder.length > 0) return { ok: false, reason: "belongs-to-another-account" };
  }

  const rows = (await db.all(
    claimedByUserId
      ? sql`SELECT id, account_type, premium_source, apple_original_transaction_id FROM users WHERE id = ${claimedByUserId}`
      : sql`SELECT id, account_type, premium_source, apple_original_transaction_id FROM users
            WHERE apple_original_transaction_id = ${tx.originalTransactionId}
               OR (${token} IS NOT NULL AND lower(id) = ${token})
            ORDER BY (apple_original_transaction_id = ${tx.originalTransactionId}) DESC LIMIT 1`
  )) as UserRow[];
  const user = rows[0];
  if (!user) return { ok: false, reason: "no-user" };

  const active = isAppleTransactionActive(tx);
  const expiresAt = typeof tx.expiresDate === "number" ? new Date(tx.expiresDate).toISOString() : null;
  const now = new Date().toISOString();

  let accountType = user.account_type;
  let premiumSource = user.premium_source;
  if (active) {
    if (accountType === "reader") { accountType = "premium"; premiumSource = "apple"; }
    else if (accountType === "premium" && !premiumSource) premiumSource = "apple";
  } else if (accountType === "premium" && premiumSource === "apple") {
    accountType = "reader";
    premiumSource = null;
  }

  await db.run(sql`
    UPDATE users SET
      account_type = ${accountType},
      premium_source = ${premiumSource},
      apple_original_transaction_id = ${tx.originalTransactionId},
      apple_expires_at = ${expiresAt},
      updated_at = ${now}
    WHERE id = ${user.id}
  `);
  return { ok: true, userId: user.id, active: accountType !== "reader", accountType };
}

/**
 * Decode a JWS payload WITHOUT verifying it. Only for Xcode's local StoreKit
 * testing, whose transactions are signed by a throwaway local certificate
 * rather than Apple. Callers must gate this on a non-production server.
 */
export function decodeJwsUnverified<T = Record<string, unknown>>(jws: string): T {
  const part = jws.split(".")[1];
  if (!part) throw new Error("Malformed JWS");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
}
