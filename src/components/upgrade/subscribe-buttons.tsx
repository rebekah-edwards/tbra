"use client";

import { useIsTwa } from "@/lib/use-twa";

import { useState } from "react";

// Display prices — keep in sync with the Stripe Price objects
// (STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL). Final pricing 2026-07-15:
// $4.99/mo · $39.99/yr (≈ 4 months free vs monthly).
const PLANS = [
  {
    plan: "monthly",
    price: "$4.99",
    per: "per month",
    note: "Billed monthly",
    badge: null,
    highlight: false,
  },
  {
    plan: "annual",
    price: "$39.99",
    per: "per year",
    note: "That's $3.33 a month",
    badge: "4 months free",
    highlight: true,
  },
] as const;

export function SubscribeButtons({
  isPremium,
  preview = false,
  manageBilling = false,
}: {
  isPremium: boolean;
  /** Staff accounts: show the cards users see, but don't let them buy. */
  preview?: boolean;
  /** Only Stripe subscribers get the billing portal — beta testers are
   *  members without a subscription to manage. */
  manageBilling?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isTwa = useIsTwa();

  // Google Play payments policy: no non-Play purchase flows inside the
  // Play-distributed app. Neutral copy, no outbound purchase links.
  if (isTwa && !isPremium) {
    return (
      <p className="text-sm text-muted text-center py-6">
        Premium subscriptions aren&rsquo;t available for purchase in this app.
      </p>
    );
  }

  async function go(path: string, body?: object) {
    setBusy(path + JSON.stringify(body ?? {}));
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || "Something went wrong.");
    } catch {
      setError("Something went wrong. Try again.");
    }
    setBusy(null);
  }

  // Staff preview shows the pricing cards even though isPremium(staff) is
  // true — otherwise admins could never see what readers see.
  if (isPremium && !preview && !manageBilling) {
    // Member without a Stripe subscription (beta tester): nothing to bill,
    // nothing to manage — just confirm the membership is active.
    return (
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-xl border-2 border-neon-purple/40 bg-neon-purple/10 px-6 py-3 text-sm font-semibold text-neon-purple">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.2L21 9l-5 4.4L17.5 20 12 16.4 6.5 20 8 13.4 3 9l6.6-.8L12 2z" /></svg>
          Based Reader — included with your account
        </span>
      </div>
    );
  }

  if (isPremium && !preview) {
    return (
      <div className="text-center">
        <button
          onClick={() => go("/api/stripe/portal")}
          disabled={busy !== null}
          className="rounded-xl border-2 border-neon-purple/40 bg-neon-purple/10 px-6 py-3 text-sm font-semibold text-neon-purple hover:bg-neon-purple/20 transition-colors disabled:opacity-50"
        >
          {busy ? "Opening…" : "Manage subscription"}
        </button>
        <p className="mt-2 text-xs text-muted">Update payment, switch plans, or cancel anytime.</p>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {PLANS.map((p) => (
          <button
            key={p.plan}
            onClick={() => !preview && go("/api/stripe/checkout", { plan: p.plan })}
            disabled={busy !== null || preview}
            className={
              p.highlight
                ? "upgrade-card-glow relative rounded-2xl border-2 border-neon-purple/60 bg-neon-purple/10 px-4 py-5 text-center backdrop-blur-sm hover:bg-neon-purple/15 transition-colors disabled:opacity-90"
                : "relative rounded-2xl border-2 border-border bg-surface/70 px-4 py-5 text-center backdrop-blur-sm hover:border-neon-purple/40 transition-colors disabled:opacity-90"
            }
          >
            {p.badge && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-neon-purple px-2.5 py-0.5 text-[10px] font-bold text-white">
                {p.badge}
              </span>
            )}
            <span className="block font-heading text-3xl font-extrabold text-foreground">
              {p.price}
            </span>
            <span className="block text-xs text-muted mt-0.5">{p.per}</span>
            <span className={`mt-3 block rounded-lg py-2 text-xs font-bold ${
              p.highlight
                ? "bg-neon-purple text-white"
                : "bg-surface-alt text-foreground"
            }`}>
              {busy ? "Redirecting…" : isPremiumLabel(p.plan)}
            </span>
            <span className="block text-[10px] text-muted mt-2">{p.note}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] text-muted">
        {preview
          ? "Admin preview — this is what reader accounts see. Staff accounts can't subscribe."
          : "Cancel anytime. Secure checkout by Stripe."}
      </p>
      {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
    </div>
  );
}

function isPremiumLabel(plan: string) {
  return plan === "annual" ? "Get the year" : "Go monthly";
}
