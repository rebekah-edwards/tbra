import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import {
  applyAppleTransaction,
  decodeJwsUnverified,
  verifyAppleJws,
  type AppleTransaction,
} from "@/lib/iap";

/**
 * POST /api/v1/iap/sync  { signedTransaction }
 *
 * The iOS app calls this after every verified StoreKit transaction (a
 * purchase, a restore, a renewal it hears about). The body is the
 * transaction's JWS exactly as StoreKit provides it. We verify Apple's
 * signature, then make the signed-in reader premium while the subscription
 * is active — or put them back to reader once it is not.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const jws = typeof body?.signedTransaction === "string" ? body.signedTransaction : "";
  if (!jws) return jsonError("signedTransaction is required.", 400);

  let tx: AppleTransaction;
  try {
    tx = await verifyAppleJws<AppleTransaction>(jws);
  } catch (err) {
    // Xcode's local StoreKit testing signs with its own certificate. Accept
    // that ONLY off production, and only when the payload says so.
    let local: AppleTransaction | null = null;
    if (process.env.NODE_ENV !== "production") {
      try {
        const decoded = decodeJwsUnverified<AppleTransaction>(jws);
        if (decoded.environment === "Xcode") local = decoded;
      } catch {
        /* fall through to the error below */
      }
    }
    if (!local) {
      console.error("[iap] transaction failed verification:", err);
      return jsonError("We couldn't verify that purchase with Apple.", 400);
    }
    tx = local;
  }

  const result = await applyAppleTransaction(tx, user.userId);
  if (!result.ok) {
    if (result.reason === "belongs-to-another-account") {
      return jsonError("This Apple subscription is already linked to a different tbr*a account.", 409);
    }
    return jsonError("That purchase isn't a Based Reader subscription.", 400);
  }
  return jsonOk({ active: result.active, accountType: result.accountType });
}
