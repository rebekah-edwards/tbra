"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface DesktopNavProps {
  isLoggedIn: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
}

const tabs = [
  { label: "Home", href: "/" },
  { label: "Discover", href: "/discover" },
  { label: "Bookshelf", href: "/library" },
  { label: "Stats", href: "/stats" },
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
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          const href = !isLoggedIn && tab.href !== "/" && tab.href !== "/discover" ? "/login" : tab.href;

          return (
            <Link
              key={tab.label}
              href={href}
              className={`
                relative px-4 py-2 rounded-full text-sm font-medium transition-all duration-200
                ${active
                  ? "text-foreground bg-black/5 dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/15 shadow-[0_0_12px_rgba(163,230,53,0.15)]"
                  : "text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 hover:backdrop-blur-sm"
                }
              `}
            >
              {active && (
                <span className="absolute inset-0 rounded-full bg-gradient-to-r from-accent/10 via-neon-blue/5 to-neon-purple/10 pointer-events-none" />
              )}
              <span className="relative">{tab.label}</span>
            </Link>
          );
        })}
      </div>

    </div>
  );
}
