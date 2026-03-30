"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/lib/actions/auth";

interface HamburgerMenuProps {
  isLoggedIn: boolean;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
}

const MENU_ITEMS = [
  { label: "Browse Library", href: "/browse", icon: "browse" },
  { label: "Settings", href: "/settings", icon: "settings" },
  { label: "Import Your Library", href: "/import", icon: "import" },
  { label: "Contact Us", href: "/contact", icon: "mail" },
];

function MenuIcon({ icon }: { icon: string }) {
  switch (icon) {
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

export function HamburgerMenu({ isLoggedIn, isAdmin = false, isSuperAdmin = false, avatarUrl, displayName }: HamburgerMenuProps) {
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
              <div className="border-t border-border my-1" />
              {MENU_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                >
                  <span className="text-muted">
                    <MenuIcon icon={item.icon} />
                  </span>
                  {item.label}
                </Link>
              ))}
              {isAdmin && (
                <>
                  <div className="border-t border-border my-1" />
                  <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Admin
                  </p>
                  <Link
                    href="/admin/review"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                  >
                    <span className="text-muted">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                    </span>
                    Review Queue
                  </Link>
                  <Link
                    href="/admin/corrections"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                  >
                    <span className="text-muted">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </span>
                    Proposed Edits
                  </Link>
                  <Link
                    href="/admin/issues"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                  >
                    <span className="text-muted">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </span>
                    Beta User Reports
                  </Link>
                  <Link
                    href="/admin/enrichment"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                  >
                    <span className="text-muted">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v4" />
                        <path d="M12 18v4" />
                        <path d="m4.93 4.93 2.83 2.83" />
                        <path d="m16.24 16.24 2.83 2.83" />
                        <path d="M2 12h4" />
                        <path d="M18 12h4" />
                        <path d="m4.93 19.07 2.83-2.83" />
                        <path d="m16.24 7.76 2.83-2.83" />
                      </svg>
                    </span>
                    Enrichment
                  </Link>
                  {isSuperAdmin && (
                    <>
                    <Link
                      href="/admin/users"
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                    >
                      <span className="text-muted">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      </span>
                      Users
                    </Link>
                    <Link
                      href="/admin/landing"
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-alt transition-colors"
                    >
                      <span className="text-muted">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7" />
                          <rect x="14" y="3" width="7" height="7" />
                          <rect x="14" y="14" width="7" height="7" />
                          <rect x="3" y="14" width="7" height="7" />
                        </svg>
                      </span>
                      Landing Page
                    </Link>
                    </>
                  )}
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
