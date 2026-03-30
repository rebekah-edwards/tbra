"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-[42px] rounded-lg border border-border bg-surface-alt" />;
  }

  const current = theme ?? "system";

  const options = [
    {
      value: "light",
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
      value: "system",
      label: "System",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      ),
    },
    {
      value: "dark",
      label: "Dark",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-indigo-300">
          <path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-alt p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
            current === opt.value
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
