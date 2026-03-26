"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/lib/actions/auth";

interface MobileMenuProps {
  email: string;
  avatarUrl?: string | null;
  displayName?: string | null;
}

export function MobileMenu({ email, avatarUrl, displayName }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const initial = (displayName || email)[0].toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-background overflow-hidden"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-border bg-surface shadow-lg z-50">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium truncate">{displayName || email}</p>
            {displayName && (
              <p className="text-xs text-muted truncate">{email}</p>
            )}
          </div>
          <div className="py-1">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-foreground hover:bg-surface-alt transition-colors"
            >
              Profile
            </Link>
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-sm text-foreground">Theme</span>
              <ThemeToggle />
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="w-full px-4 py-2 text-left text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
