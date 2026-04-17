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
    pathname === "/buddy-reads" ||
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
    pathname.startsWith("/library/") ||
    pathname.startsWith("/buddy-reads/")
  ) {
    return null;
  }

  return (
    <button
      onClick={() => router.back()}
      className="lg:hidden fixed top-[calc(env(safe-area-inset-top)+71px)] left-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-white/10 backdrop-blur-md text-foreground/90 hover:text-foreground hover:bg-white/20 hover:border-white/40 transition-all shadow-lg"
      aria-label="Go back"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}
