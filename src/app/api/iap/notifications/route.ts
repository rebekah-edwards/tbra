import { NextResponse } from "next/server";
import { applyAppleTransaction, verifyAppleJws, type AppleTransaction } from "@/lib/iap";

/**
 * POST /api/iap/notifications — App Store Server Notifications V2.
 *
 * Apple calls this when a subscription renews, lapses, is refunded or is
 * revoked, whether or not the app is ever opened again. The body is
 * `{ signedPayload }`, a JWS; the transaction inside it is a second JWS.
 * Both are verified against Apple's root before anything is applied.
 *
 * Configured in App Store Connect → App Information → App Store Server
 * Notifications (production and sandbox both point here).
 *
 * Response codes matter: Apple retries anything that is not 2xx. A
 * notification we verified but have nothing to do with (no matching
 * account) is answered 200 so it is not retried for days.
 */
interface NotificationPayload {
  notificationType?: string;
  subtype?: string;
  data?: { bundleId?: string; environment?: string; signedTransactionInfo?: string };
}

export async function POST(req: Request) {
  let signedPayload = "";
  try {
    const body = (await req.json()) as { signedPayload?: unknown };
    if (typeof body.signedPayload === "string") signedPayload = body.signedPayload;
  } catch {
    /* handled below */
  }
  if (!signedPayload) return NextResponse.json({ ok: false, error: "signedPayload required" }, { status: 400 });

  let payload: NotificationPayload;
  let tx: AppleTransaction | null = null;
  try {
    payload = await verifyAppleJws<NotificationPayload>(signedPayload);
    const inner = payload.data?.signedTransactionInfo;
    if (inner) tx = await verifyAppleJws<AppleTransaction>(inner);
  } catch (err) {
    console.error("[iap] notification failed verification:", err);
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 400 });
  }

  // Nothing to apply (e.g. TEST, or a type that carries no transaction).
  if (!tx) return NextResponse.json({ ok: true, handled: false });

  // A failed renewal inside Apple's billing grace period still owes the
  // reader access; the EXPIRED / GRACE_PERIOD_EXPIRED that follows ends it.
  if (payload.notificationType === "DID_FAIL_TO_RENEW" && payload.subtype === "GRACE_PERIOD") {
    return NextResponse.json({ ok: true, handled: false });
  }

  try {
    const result = await applyAppleTransaction(tx);
    if (!result.ok) {
      console.warn(`[iap] ${payload.notificationType}: not applied (${result.reason})`);
      return NextResponse.json({ ok: true, handled: false });
    }
    console.log(`[iap] ${payload.notificationType}${payload.subtype ? `/${payload.subtype}` : ""} → ${result.accountType}`);
    return NextResponse.json({ ok: true, handled: true });
  } catch (err) {
    // A database failure IS worth a retry.
    console.error("[iap] notification could not be applied:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
