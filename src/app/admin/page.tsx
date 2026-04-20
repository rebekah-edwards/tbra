import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, isAdmin, isSuperAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Admin | tbr*a",
  robots: { index: false },
};

interface AdminCard {
  href: string;
  title: string;
  description: string;
  superAdmin?: boolean;
  icon: React.ReactNode;
}

const ADMIN_CARDS: AdminCard[] = [
  {
    href: "/admin/review",
    title: "Review Queue",
    description: "Books flagged for review by readers or enrichment.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
    ),
  },
  {
    href: "/admin/corrections",
    title: "Proposed Edits",
    description: "User-submitted metadata corrections awaiting approval.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    href: "/admin/issues",
    title: "Beta User Reports",
    description: "Issue reports from users — bugs, data complaints, feature asks.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  {
    href: "/admin/arc-reviews",
    title: "ARC Reviews",
    description: "Pre-release reviews awaiting your approval.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ),
  },
  {
    href: "/admin/covers",
    title: "Cover Review",
    description: "Books missing a cover, waiting for a manual replacement.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    ),
  },
  {
    href: "/admin/enrichment",
    title: "Enrichment",
    description: "Enrichment queue + status for unenriched books.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4" />
        <path d="M12 18v4" />
        <path d="m4.93 4.93 2.83 2.83" />
        <path d="m16.24 16.24 2.83 2.83" />
        <path d="M2 12h4" />
        <path d="M18 12h4" />
        <path d="m4.93 19.07 2.83-2.83" />
        <path d="m16.24 7.76 2.83-2.83" />
      </svg>
    ),
  },
  {
    href: "/admin/users",
    title: "Users",
    description: "All users — roles, account types, activity.",
    superAdmin: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "/admin/landing",
    title: "Landing Page",
    description: "Featured books + marketing copy for the homepage.",
    superAdmin: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    href: "/admin/broadcast",
    title: "Broadcast",
    description: "Send a notification to all users at once.",
    superAdmin: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 11 18-5v12L3 14v-3z" />
        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </svg>
    ),
  },
];

export default async function AdminDashboard() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  const isSuper = isSuperAdmin(user);
  const visibleCards = ADMIN_CARDS.filter((c) => !c.superAdmin || isSuper);

  return (
    <div className="space-y-6 lg:w-[60%] lg:mx-auto pb-24 lg:pb-8">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">Admin</h1>
        <p className="text-sm text-muted mt-1">
          Moderation queues and site management tools.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visibleCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex gap-4 rounded-xl border border-border bg-surface p-4 hover:border-accent/60 hover:bg-surface-alt transition-colors"
          >
            <div className="flex-shrink-0 flex h-11 w-11 items-center justify-center rounded-lg bg-surface-alt text-foreground group-hover:bg-accent/10 group-hover:text-accent transition-colors">
              {card.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground truncate">{card.title}</h2>
                {card.superAdmin && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted bg-surface-alt px-1.5 py-0.5 rounded-full border border-border">
                    Super
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mt-0.5 line-clamp-2">{card.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
