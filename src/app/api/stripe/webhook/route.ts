import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";

/**
 * POST /api/stripe/webhook — Stripe events, signature-verified.
 *
 * Account rules: only 'reader' ⇄ 'premium' ever flip here. Admin, super_admin,
 * and beta_tester accounts are NEVER touched by billing events — paying (or a
 * lapsed card) must not change a staff account's powers.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) return NextResponse.json({ error: "Not configured." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), sig, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  async function setType(userId: string, type: "premium" | "reader") {
    const row = await db.select({ accountType: users.accountType })
      .from(users).where(eq(users.id, userId)).get();
    if (!row) return;
    if (!["reader", "premium"].includes(row.accountType)) return; // staff accounts untouched
    if (row.accountType === type) return;
    await db.update(users)
      .set({ accountType: type, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));
  }

  async function userByCustomer(customerId: string) {
    const row = await db.select({ id: users.id })
      .from(users).where(eq(users.stripeCustomerId, customerId)).get();
    return row?.id ?? null;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      if (userId) {
        // Persist the customer id (covers accounts created pre-checkout).
        if (typeof session.customer === "string") {
          await db.update(users)
            .set({ stripeCustomerId: session.customer, updatedAt: new Date().toISOString() })
            .where(eq(users.id, userId));
        }
        await setType(userId, "premium");
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      if (typeof sub.customer !== "string") break;
      const userId = await userByCustomer(sub.customer);
      if (!userId) break;
      if (["active", "trialing", "past_due"].includes(sub.status)) {
        await setType(userId, "premium");
      } else if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) {
        await setType(userId, "reader");
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      if (typeof sub.customer !== "string") break;
      const userId = await userByCustomer(sub.customer);
      if (userId) await setType(userId, "reader");
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
