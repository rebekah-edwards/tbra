import Stripe from "stripe";

/**
 * Server-side Stripe client. STRIPE_SECRET_KEY is test-mode until launch —
 * swap the key in Vercel env (and .env.local) to go live; no code changes.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  typescript: true,
});

export const STRIPE_PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
  annual: process.env.STRIPE_PRICE_ANNUAL ?? "",
} as const;

export type BillingPlan = keyof typeof STRIPE_PRICES;
