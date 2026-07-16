import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe, STRIPE_PRICES, type BillingPlan } from "@/lib/stripe";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://thebasedreader.app";

/**
 * POST /api/v1/stripe — bearer-auth twin of the web checkout/portal routes,
 * for the native app's in-app purchase sheet.
 *
 * Body: { action: "checkout", plan: "monthly" | "annual" } → { url }
 *       { action: "portal" }                               → { url }
 *
 * The URL opens in an in-app Safari sheet. Stripe's webhook (on live) flips
 * account_type; the app sees it after the next user-activity sync.
 */
export async function POST(req: Request) {
  const session = await getApiUser(req);
  if (!session) return jsonError("Unauthorized.", 401);
  if (!process.env.STRIPE_SECRET_KEY) return jsonError("Billing is not configured.", 500);

  let body: { action?: string; plan?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid body.", 400);
  }

  const row = await db
    .select({ id: users.id, email: users.email, accountType: users.accountType, stripeCustomerId: users.stripeCustomerId })
    .from(users).where(eq(users.id, session.userId)).get();
  if (!row) return jsonError("Account not found.", 404);

  if (body.action === "portal") {
    if (!row.stripeCustomerId) return jsonError("No subscription on this account.", 400);
    const portal = await stripe.billingPortal.sessions.create({
      customer: row.stripeCustomerId,
      return_url: `${SITE}/upgrade`,
    });
    return jsonOk({ url: portal.url });
  }

  // checkout
  if (["premium", "beta_tester", "admin", "super_admin"].includes(row.accountType)) {
    return jsonError("This account already has premium access.", 400);
  }
  const plan: BillingPlan = body.plan === "annual" ? "annual" : "monthly";
  const price = STRIPE_PRICES[plan];
  if (!price) return jsonError("Billing is not configured.", 500);

  let customerId = row.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: row.email,
      metadata: { tbraUserId: row.id },
    });
    customerId = customer.id;
    await db.update(users)
      .set({ stripeCustomerId: customerId, updatedAt: new Date().toISOString() })
      .where(eq(users.id, row.id));
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: row.id,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${SITE}/upgrade?welcome=1`,
    cancel_url: `${SITE}/upgrade`,
  });
  return jsonOk({ url: checkout.url });
}
