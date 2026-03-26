"use client";

import Link from "next/link";
import { useTheme } from "next-themes";

interface SocialIconsProps {
  instagram?: string | null;
  tiktok?: string | null;
  threads?: string | null;
  twitter?: string | null;
  className?: string;
}

const platforms = [
  {
    key: "instagram" as const,
    urlPrefix: "https://instagram.com/",
    label: "Instagram",
    // IG gradient glyph is the same in both themes
    darkIcon: "/icons/social/instagram.png",
    lightIcon: "/icons/social/instagram.png",
  },
  {
    key: "tiktok" as const,
    urlPrefix: "https://tiktok.com/@",
    label: "TikTok",
    darkIcon: "/icons/social/tiktok-white.svg",
    lightIcon: "/icons/social/tiktok-black.svg",
  },
  {
    key: "threads" as const,
    urlPrefix: "https://threads.net/@",
    label: "Threads",
    darkIcon: "/icons/social/threads-white.svg",
    lightIcon: "/icons/social/threads-black.svg",
  },
  {
    key: "twitter" as const,
    urlPrefix: "https://x.com/",
    label: "X",
    darkIcon: "/icons/social/x-white.png",
    lightIcon: "/icons/social/x-black.png",
  },
] as const;

export function SocialIcons({ instagram, tiktok, threads, twitter, className = "" }: SocialIconsProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const handles = { instagram, tiktok, threads, twitter };
  const active = platforms.filter((p) => handles[p.key]);

  if (active.length === 0) return null;

  return (
    <div className={`flex flex-wrap justify-center items-center gap-4 ${className}`}>
      {active.map(({ key, urlPrefix, label, darkIcon, lightIcon }) => (
        <Link
          key={key}
          href={`${urlPrefix}${handles[key]}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center h-7 transition-opacity hover:opacity-70"
          title={`@${handles[key]} on ${label}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={isDark ? darkIcon : lightIcon}
            alt={label}
            className="h-7 w-7"
          />
        </Link>
      ))}
    </div>
  );
}
