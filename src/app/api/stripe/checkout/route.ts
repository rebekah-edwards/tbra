import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe, STRIPE_PRICES, type BillingPlan } from "@/lib/stripe";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://thebasedreader.app";

/**
 * POST /api/stripe/checkout — { plan: "monthly" | "annual" }
 * Creates a subscription Checkout session and returns { url }.
 */
export async function POST(req: Request) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let plan: BillingPlan = "monthly";
  try {
    const body = await req.json();
    if (body.plan === "annual") plan = "annual";
  } catch { /* default monthly */ }

  const price = STRIPE_PRICES[plan];
  if (!price || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 500 });
  }

  const row = await db
    .select({ id: users.id, email: users.email, accountType: users.accountType, stripeCustomerId: users.stripeCustomerId })
    .from(users).where(eq(users.id, session.userId)).get();
  if (!row) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  // Admin/beta accounts already have everything — nothing to buy.
  if (["premium", "beta_tester", "admin", "super_admin"].includes(row.accountType)) {
    return NextResponse.json({ error: "This account already has premium access." }, { status: 400 });
  }

  // One Stripe customer per account, created lazily.
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

  return NextResponse.json({ url: checkout.url });
}
