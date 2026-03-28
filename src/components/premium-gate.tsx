"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface PremiumGateProps {
  isPremium: boolean;
  children: ReactNode;
  /** Optional custom fallback. Defaults to the standard upgrade prompt. */
  fallback?: ReactNode;
  /** Feature name shown in the upgrade prompt (e.g., "Custom Shelves") */
  featureName?: string;
}

/**
 * Gate wrapper for premium-only features.
 * Shows children if user has premium access, otherwise shows an upgrade prompt.
 *
 * Usage:
 *   <PremiumGate isPremium={isPremium(user)} featureName="Custom Shelves">
 *     <MyPremiumFeature />
 *   </PremiumGate>
 */
export function PremiumGate({
  isPremium,
  children,
  fallback,
  featureName,
}: PremiumGateProps) {
  if (isPremium) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return (
    <div className="rounded-xl border border-border bg-surface p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neon-purple/15">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-neon-purple"
        >
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h3 className="font-heading text-lg font-bold text-foreground">
        {featureName ? `Unlock ${featureName}` : "Upgrade to Based Reader"}
      </h3>
      <p className="mt-1 text-sm text-muted max-w-xs mx-auto">
        {featureName
          ? `${featureName} is a Based Reader feature. Upgrade to unlock this and other premium features.`
          : "Get access to custom shelves, reading challenges, advanced stats, and more."}
      </p>
      <Link
        href="/upgrade"
        className="mt-4 inline-block rounded-lg bg-neon-purple px-6 py-2 text-sm font-semibold text-white hover:bg-neon-purple/90 transition-colors"
      >
        Learn More
      </Link>
    </div>
  );
}

/**
 * Inline premium badge/pill for use next to feature labels.
 * Shows a small "PRO" pill to indicate premium-only features.
 */
export function PremiumBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-neon-purple/30 bg-neon-purple/10 px-1.5 py-0.5 text-[9px] font-bold text-neon-purple uppercase tracking-wider">
      <svg
        width="8"
        height="8"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="none"
        className="shrink-0"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      PRO
    </span>
  );
}
