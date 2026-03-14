"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-[34px] w-[72px]" />;
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative flex h-[34px] w-[72px] flex-shrink-0 items-center rounded-full border border-border bg-surface-alt p-[3px] transition-colors"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      {/* Sliding indicator */}
      <div
        className={`absolute top-[3px] h-[26px] w-[32px] rounded-full bg-surface shadow-md transition-all duration-300 ease-in-out ${
          isDark ? "left-[37px]" : "left-[3px]"
        }`}
      />
      {/* Sun — chunky with thick rays */}
      <span
        className={`relative z-10 flex h-[26px] w-[32px] items-center justify-center transition-opacity duration-200 ${
          !isDark ? "opacity-100" : "opacity-30"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
          <circle cx="12" cy="12" r="5" />
          <rect x="11" y="1" width="2" height="4" rx="1" />
          <rect x="11" y="19" width="2" height="4" rx="1" />
          <rect x="19" y="11" width="4" height="2" rx="1" />
          <rect x="1" y="11" width="4" height="2" rx="1" />
          <rect x="17.2" y="3.4" width="2" height="4" rx="1" transform="rotate(45 18.2 5.4)" />
          <rect x="4.8" y="16.6" width="2" height="4" rx="1" transform="rotate(45 5.8 18.6)" />
          <rect x="16.6" y="17.2" width="4" height="2" rx="1" transform="rotate(45 18.6 18.2)" />
          <rect x="3.4" y="4.8" width="4" height="2" rx="1" transform="rotate(45 5.4 5.8)" />
        </svg>
      </span>
      {/* Moon — solid chunky crescent */}
      <span
        className={`relative z-10 flex h-[26px] w-[32px] items-center justify-center transition-opacity duration-200 ${
          isDark ? "opacity-100" : "opacity-30"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-indigo-300">
          <path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646z" />
        </svg>
      </span>
    </button>
  );
}
