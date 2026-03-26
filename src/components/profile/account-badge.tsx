"use client";

import type { AccountType } from "@/lib/auth";

interface AccountBadgeProps {
  accountType: string;
}

const badgeConfig: Record<
  AccountType,
  { label: string; className: string; icon?: "star" }
> = {
  reader: {
    label: "Reader",
    className:
      "reader-badge border-accent bg-accent/20",
  },
  based_reader: {
    label: "Based Reader",
    className: "border-neon-purple bg-neon-purple/20 text-neon-purple",
  },
  beta_tester: {
    label: "Beta Tester",
    className: "reader-badge border-accent bg-accent/20",
    icon: "star",
  },
  admin: {
    label: "Admin",
    className: "border-neon-purple bg-neon-purple/20 text-neon-purple",
  },
  super_admin: {
    label: "Super Admin",
    className: "border-neon-purple bg-neon-purple/20 text-neon-purple",
  },
};

export function AccountBadge({ accountType }: AccountBadgeProps) {
  const config = badgeConfig[accountType as AccountType] ?? badgeConfig.reader;

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap mt-0.5 ${config.className}`}
    >
      {config.icon === "star" && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="none"
          className="shrink-0"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      )}
      {config.label}
    </span>
  );
}
