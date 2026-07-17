"use client";

import { useIsTwa } from "@/lib/use-twa";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/lib/actions/auth";

interface HamburgerMenuProps {
  isLoggedIn: boolean;
  isAdmin?: boolean;
  /** premium / beta_tester / admin / super_admin — free accounts see "Upgrade to Premium" */
  isPremium?: boolean;
  isSuperAdmin?: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
}

const MENU_ITEMS = [
  // Label is plan-aware — see the render loop ("Upgrade to Premium" for
  // free accounts, "Based Reader Premium" for subscribers/staff).
  { label: "Based Reader Premium", href: "/upgrade", icon: "star", authRequired: true },
  { label: "Find Readers", href: "/people", icon: "people", authRequired: true },
  { label: "Buddy Reads", href: "/buddy-reads", icon: "buddy-reads", authRequired: true },
  { label: "Browse All Books", href: "/browse", icon: "browse" },
  { label: "Import Your Library", href: "/import", icon: "import" },
  { label: "Contact Us", href: "/contact", icon: "mail" },
];

function MenuIcon({ icon }: { icon: string }) {
  switch (icon) {
    case "buddy-reads":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "people":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
          <circle cx="18" cy="10" r="2.5" />
          <path d="m17 17 4 4" />
        </svg>
      );
    case "browse":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
          <path d="M11 8v6" />
          <path d="M8 11h6" />
        </svg>
      );
    case "settings":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "bell":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
    case "import":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case "star":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "mail":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="20" height="16" x="2" y="4" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      );
    case "signout":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );
    default:
      return null;
  }
}

export function HamburgerMenu({ isLoggedIn, isAdmin = false, isSuperAdmin = false, isPremium = false, avatarUrl, displayName }: HamburgerMenuProps) {
  const isTwa = useIsTwa();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
        aria-label="Menu"
        aria-expanded={isOpen}
      >
        {/* Mobile: hamburger / close icon (always shown) */}
        {/* Desktop logged-out: also show hamburger */}
        <span className={isLoggedIn ? "lg:hidden" : ""}>
          {isOpen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          )}
        </span>
        {/* Desktop logged-in: avatar */}
        {isLoggedIn && (
          <span className="hidden lg:flex w-8 h-8 rounded-full overflow-hidden border-2 border-transparent hover:border-[#a3e635]/50 transition-colors">
            {avatarUrl ? (
              <Image src={avatarUrl} alt="Menu" width={32} height={32} className="w-full h-full object-cover" />
            ) : (
              <span className="w-full h-full flex items-center justify-center text-xs font-bold text-black" style={{ backgroundColor: "#a3e635" }}>
                {displayName ? displayName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) : "?"}
              </span>
            )}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setIsOpen(false)} />
          {/* Menu dropdown */}
          <div className="absolute right-0 top-full mt-2 z-50 w-56 rounded-xl border border-border bg-surface shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="py-1">
              {!isLoggedIn ? (
                <>
                  <Link
                    href="/login"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                  >
                    <span className="text-muted">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                        <polyline points="10 17 15 12 10 7" />
                        <line x1="15" y1="12" x2="3" y2="12" />
                      </svg>
                    </span>
                    Sign In
                  </Link>
                  <div className="border-t border-border my-1" />
                  <Link
                    href="/methodology"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                  >
                    <span className="text-muted">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                    </span>
                    Our Methodology
                  </Link>
                  <Link
                    href="/discover"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                  >
                    <span className="text-muted">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </span>
                    Discover Books
                  </Link>
                  <div className="border-t border-border my-1" />
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-foreground">Theme</span>
                    <ThemeToggle />
                  </div>
                </>
              ) : (
              <>
              <Link
                href="/profile"
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
              >
                <span className="text-muted">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                View Profile
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
              >
                <span className="text-muted">
                  <MenuIcon icon="settings" />
                </span>
                Settings
              </Link>
              <div className="border-t border-border my-1" />
              {MENU_ITEMS.filter((item) => !(item.href === "/upgrade" && isTwa && !isPremium)).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                >
                  <span className="text-muted">
                    <MenuIcon icon={item.icon} />
                  </span>
                  {item.href === "/upgrade" && !isPremium ? "Upgrade to Premium" : item.label}
                </Link>
              ))}
              {isAdmin && (
                <>
                  <div className="border-t border-border my-1" />
                  <Link
                    href="/admin"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                  >
                    <span className="text-muted">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                    </span>
                    Admin
                  </Link>
                </>
              )}
              <div className="border-t border-border my-1" />
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-foreground">Theme</span>
                <ThemeToggle />
              </div>
              <div className="border-t border-border my-1" />
              <form action={logout}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-surface-alt transition-colors"
                >
                  <MenuIcon icon="signout" />
                  Sign Out
                </button>
              </form>
              </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
