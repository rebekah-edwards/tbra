"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface DesktopNavProps {
  isLoggedIn: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
}

const TABS_LOGGED_IN = [
  { label: "Home", href: "/" },
  { label: "Discover", href: "/discover" },
  { label: "Browse", href: "/browse" },
  { label: "My Library", href: "/library" },
  { label: "Stats", href: "/stats" },
];

const TABS_LOGGED_OUT = [
  { label: "Home", href: "/" },
  { label: "Discover", href: "/discover" },
  { label: "Browse", href: "/browse" },
  { label: "Our Methodology", href: "/methodology" },
];

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function DesktopNav({ isLoggedIn, avatarUrl, displayName }: DesktopNavProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <div className="hidden lg:flex items-center gap-6 flex-1 ml-8">
      {/* Nav links — left justified after logo */}
      <div className="flex items-center gap-1">
        {(isLoggedIn ? TABS_LOGGED_IN : TABS_LOGGED_OUT).map((tab) => {
          const active = isActive(tab.href);
          const href = tab.href;

          return (
            <Link
              key={tab.label}
              href={href}
              className={`relative px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute left-3 right-3 -bottom-0.5 h-[2px] rounded-full bg-accent"
                />
              )}
            </Link>
          );
        })}
      </div>

    </div>
  );
}
