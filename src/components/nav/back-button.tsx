"use client";

import { useRouter, usePathname } from "next/navigation";

export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  // Don't show on home page, top-level tab pages, or sub-pages that have their own back nav
  if (
    pathname === "/" ||
    pathname === "/discover" ||
    pathname === "/library" ||
    pathname === "/stats" ||
    pathname === "/profile" ||
    pathname === "/settings" ||
    pathname === "/browse" ||
    pathname === "/signup" ||
    pathname === "/login" ||
    // Sub-pages with their own navigation headers
    pathname.endsWith("/reviews") ||
    pathname.startsWith("/author/") ||
    pathname.startsWith("/series/") ||
    pathname.startsWith("/u/") ||
    pathname.startsWith("/profile/") ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/import") ||
    pathname.startsWith("/library/")
  ) {
    return null;
  }

  return (
    <button
      onClick={() => router.back()}
      className="lg:hidden fixed top-[calc(env(safe-area-inset-top)+68px)] left-4 z-40 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-white/80 active:bg-black/50 transition-colors"
      aria-label="Go back"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}
