"use client";

import type { AccountType } from "@/lib/auth";

interface AccountBadgeProps {
  accountType: string;
  /** Admin surfaces: show the REAL tier. Public default folds beta_tester
   *  into the Based Reader badge — testers are indistinguishable from
   *  paying members everywhere users can see (rule 2026-07-22). */
  exact?: boolean;
}

// 2026-11 refresh: badges are neutral glass; the tier's hue is carried by a
// dot (lime for Reader, purple for Based Reader and staff) or the star.
const badgeConfig: Record<
  AccountType,
  { label: string; dot: string; icon?: "star" }
> = {
  reader: { label: "Reader", dot: "bg-accent" },
  premium: { label: "Based Reader", dot: "text-neon-purple", icon: "star" },
  beta_tester: { label: "Beta Tester", dot: "text-accent", icon: "star" },
  admin: { label: "Admin", dot: "bg-neon-purple" },
  super_admin: { label: "Super Admin", dot: "bg-neon-purple" },
};

export function AccountBadge({ accountType, exact = false }: AccountBadgeProps) {
  const effective = !exact && accountType === "beta_tester" ? "premium" : accountType;
  const config = badgeConfig[effective as AccountType] ?? badgeConfig.reader;

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-foreground/12 bg-surface/70 px-2 py-0.5 text-[10px] font-semibold text-foreground backdrop-blur-md">
      {config.icon === "star" ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="none"
          className={`shrink-0 ${config.dot}`}
          aria-hidden="true"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ) : (
        <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${config.dot}`} aria-hidden="true" />
      )}
      {config.label}
    </span>
  );
}
