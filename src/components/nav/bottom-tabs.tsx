"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface BottomTabsProps {
  isLoggedIn: boolean;
  avatarUrl?: string | null;
}

const tabs = [
  {
    label: "Discover",
    href: "/discover",
    authRequired: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Gem / Diamond */}
        <path d="M6 3h12l4 6-10 13L2 9z" />
        <path d="M2 9h20" />
        <path d="M10 3l-2 6 4 13 4-13-2-6" />
      </svg>
    ),
  },
  {
    label: "Bookshelf",
    href: "/library",
    authRequired: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="2" width="18" height="20" rx="1" />
        <line x1="3" y1="8" x2="21" y2="8" />
        <line x1="3" y1="14" x2="21" y2="14" />
        <line x1="7" y1="3" x2="7" y2="7" />
        <line x1="10" y1="4" x2="10" y2="7" />
        <line x1="13" y1="3" x2="13" y2="7" />
        <line x1="8" y1="9" x2="8" y2="13" />
        <line x1="11" y1="10" x2="11" y2="13" />
        <line x1="15" y1="9" x2="15" y2="13" />
        <line x1="7" y1="15" x2="7" y2="21" />
        <line x1="12" y1="16" x2="12" y2="21" />
        <line x1="16" y1="15" x2="16" y2="21" />
      </svg>
    ),
  },
  {
    label: "Home",
    href: "/",
    authRequired: false,
    isHome: true,
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    label: "Stats",
    href: "/stats",
    authRequired: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    label: "Profile",
    href: "/profile",
    authRequired: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export function BottomTabs({ isLoggedIn, avatarUrl }: BottomTabsProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    if (href === "/discover") return pathname === "/discover";
    return pathname.startsWith(href);
  }

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-surface/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto grid grid-cols-5 max-w-3xl items-center px-2">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          const href = tab.authRequired && !isLoggedIn ? "/login" : tab.href;
          const isProfile = tab.label === "Profile";
          const isHome = "isHome" in tab && tab.isHome;

          if (isHome) {
            // Standout Home button in center — no label, larger circle
            return (
              <Link
                key={tab.label}
                href={href}
                className="flex items-center justify-center -mt-5"
              >
                <div className={`flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all ${
                  active
                    ? "bg-accent text-black shadow-accent/30"
                    : "bg-surface-alt text-muted border border-border hover:bg-accent hover:text-black hover:shadow-accent/20"
                }`}>
                  {tab.icon}
                </div>
              </Link>
            );
          }

          return (
            <Link
              key={tab.label}
              href={href}
              className={`flex flex-col items-center gap-0.5 px-3 py-2.5 text-[10px] font-medium transition-colors ${
                active
                  ? "text-neon-purple"
                  : "text-muted hover:text-accent"
              }`}
            >
              {isProfile && avatarUrl ? (
                <div className={`w-[22px] h-[22px] rounded-full overflow-hidden flex-shrink-0 ${
                  active ? "ring-2 ring-neon-purple" : "ring-1 ring-border"
                }`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                tab.icon
              )}
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
