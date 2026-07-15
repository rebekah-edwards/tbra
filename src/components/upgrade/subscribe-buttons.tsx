"use client";

import { useState } from "react";

// Display prices — placeholders until final pricing is chosen. Keep in sync
// with the Stripe Price objects (STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL).
const MONTHLY_LABEL = "$4.99/month";
const ANNUAL_LABEL = "$49.99/year";
const ANNUAL_NOTE = "2 months free";

export function SubscribeButtons({ isPremium }: { isPremium: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (isPremium) {
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => go("/api/stripe/checkout", { plan: "monthly" })}
          disabled={busy !== null}
          className="rounded-xl border-2 border-border bg-surface px-6 py-4 text-center hover:border-neon-purple/50 transition-colors disabled:opacity-50"
        >
          <span className="block font-heading text-lg font-bold text-foreground">{MONTHLY_LABEL}</span>
          <span className="block mt-1 text-xs text-muted">Billed monthly · cancel anytime</span>
        </button>
        <button
          onClick={() => go("/api/stripe/checkout", { plan: "annual" })}
          disabled={busy !== null}
          className="relative rounded-xl border-2 border-neon-purple/50 bg-neon-purple/5 px-6 py-4 text-center hover:bg-neon-purple/10 transition-colors disabled:opacity-50"
        >
          <span className="absolute -top-2.5 right-4 rounded-full bg-neon-purple px-2.5 py-0.5 text-[10px] font-bold text-white">
            {ANNUAL_NOTE}
          </span>
          <span className="block font-heading text-lg font-bold text-foreground">{ANNUAL_LABEL}</span>
          <span className="block mt-1 text-xs text-muted">Billed yearly · cancel anytime</span>
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        Secure checkout by Stripe. {busy ? "Redirecting…" : ""}
      </p>
      {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
    </div>
  );
}
