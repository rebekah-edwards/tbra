import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://thebasedreader.app";

/**
 * POST /api/stripe/portal — Stripe Billing Portal session for the signed-in
 * subscriber (update card, switch plan, cancel). Returns { url }.
 */
export async function POST() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const row = await db.select({ stripeCustomerId: users.stripeCustomerId })
    .from(users).where(eq(users.id, session.userId)).get();
  if (!row?.stripeCustomerId) {
    return NextResponse.json({ error: "No subscription on this account." }, { status: 400 });
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${SITE}/upgrade`,
  });
  return NextResponse.json({ url: portal.url });
}
