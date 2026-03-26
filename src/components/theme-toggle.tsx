"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-[34px] w-[108px]" />;
  }

  // Resolve "system" as default when theme is undefined
  const current = theme ?? "system";

  const options = [
    {
      key: "light",
      label: "Light",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
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
      ),
    },
    {
      key: "system",
      label: "System",
      icon: (
        <>
          {/* Monitor icon — hidden below 768px */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted hidden md:block">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          {/* Smartphone icon — visible below 768px */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted block md:hidden">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
        </>
      ),
    },
    {
      key: "dark",
      label: "Dark",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-indigo-300">
          <path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646z" />
        </svg>
      ),
    },
  ] as const;

  const activeIndex = options.findIndex((o) => o.key === current);
  // Each segment is 34px wide (total ~108px with 3 segments + padding)
  const segmentWidth = 34;

  return (
    <div
      className="relative flex h-[34px] flex-shrink-0 items-center rounded-full border border-border bg-surface-alt p-[3px]"
      role="radiogroup"
      aria-label="Theme"
    >
      {/* Sliding indicator */}
      <div
        className="absolute top-[3px] h-[26px] w-[34px] rounded-full bg-surface shadow-md transition-all duration-300 ease-in-out"
        style={{ left: `${3 + activeIndex * segmentWidth}px` }}
      />
      {options.map((opt) => (
        <button
          key={opt.key}
          role="radio"
          aria-checked={current === opt.key}
          aria-label={`${opt.label} theme`}
          onClick={() => setTheme(opt.key)}
          className={`relative z-10 flex h-[26px] w-[34px] items-center justify-center transition-opacity duration-200 ${
            current === opt.key ? "opacity-100" : "opacity-30"
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
