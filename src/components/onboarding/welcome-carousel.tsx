"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/**
 * First-launch onboarding carousel — the web twin of the native iOS
 * OnboardingView (native-ios/AuthStore.swift). Keep pages/copy in sync.
 * Shown at /welcome; OnboardingGate routes installed-app (PWA/TWA) first
 * launches here. Completing (or skipping) sets localStorage so it's
 * one-shot per device.
 */

const SEEN_KEY = "tbraSeenOnboarding";

function Chip({ label, icon, tint }: { label: string; icon?: React.ReactNode; tint: "accent" | "blue" | "purple" }) {
  // Translucent pills per BRANDING.md. text-accent is force-flipped to
  // near-black in light mode by the globals.css override.
  const cls =
    tint === "accent"
      ? "text-accent bg-accent/15 border-accent/35"
      : tint === "blue"
        ? "text-neon-blue bg-neon-blue/15 border-neon-blue/35"
        : "text-neon-purple bg-neon-purple/15 border-neon-purple/35";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

const HeartIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
);
const ThumbsDownIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" /></svg>
);

const PAGES = [
  {
    key: "welcome",
    art: (
      <div className="flex flex-col items-center gap-4">
        <span className="logo-gradient font-logo text-4xl tracking-tight">tbr*a</span>
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface/75 p-4 text-left">
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-2xl font-bold text-foreground">based</span>
            <span className="text-sm text-muted">/beɪst/</span>
            <span className="text-sm italic text-muted">adj.</span>
          </div>
          <div className="my-2 h-px bg-border" />
          <p className="text-sm italic leading-relaxed text-foreground/85">
            being authentically yourself, unapologetic, and confident in your
            beliefs, regardless of what others think
          </p>
        </div>
      </div>
    ),
    headline: "Know what's in a book before you read it",
    copy: "Decide exactly what you do (and don't) want to read. Track your reading, manage your owned library, and see reviews from other based readers — all in one place.",
  },
  {
    key: "content",
    art: (
      <div className="flex flex-col items-center gap-3">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M12 22V2" fill="#a3e635" stroke="none" />
        </svg>
        <div className="flex flex-wrap justify-center gap-2">
          <Chip label="Violence · Mild" tint="accent" />
          <Chip label="Language · None" tint="blue" />
        </div>
        <Chip label="Sexual Content · Moderate" tint="purple" />
        <div className="flex flex-wrap justify-center gap-2">
          <Chip label="Fantasy" icon={HeartIcon} tint="accent" />
          <Chip label="Horror" icon={ThumbsDownIcon} tint="blue" />
        </div>
      </div>
    ),
    headline: "See What's Inside",
    copy: "Every book gets detailed content ratings — violence, language, sexual content, and more. Set your comfort zone once and we'll flag anything that crosses it. Then fine-tune what you DO want: heart the genres you love and dismiss the ones you don't.",
  },
  {
    key: "library",
    art: (
      <div className="flex flex-col items-center gap-3">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <div className="flex flex-wrap justify-center gap-2">
          <Chip label="Reading Now" tint="accent" />
          <Chip label="TBR" tint="blue" />
          <Chip label="Finished ✓" tint="purple" />
        </div>
      </div>
    ),
    headline: "Know Your Library",
    copy: "Log what you're reading in any format — hardcover, paperback, eBook, or audio. Your reading goals, streaks, stats, re-reads, and owned library are all tracked automatically.",
  },
  {
    key: "premium",
    art: (
      <div className="flex flex-col items-center gap-3">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="#c084fc"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 6l1.85 3.75 4.15.6-3 2.93.71 4.12L12 15.45 8.29 17.4 9 13.28l-3-2.93 4.15-.6z" /></svg>
        <div className="flex flex-wrap justify-center gap-2">
          <Chip label="Custom Shelves" tint="purple" />
          <Chip label="Notes to Self" tint="blue" />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Chip label="Buddy Reads" tint="accent" />
          <Chip label="Discover" tint="purple" />
        </div>
      </div>
    ),
    headline: "Make It Yours",
    copy: "Organize books any way you like with custom shelves, keep private notes on your TBR, and read together with buddy reads. Then let Discover match books to your exact taste — so every recommendation actually fits.",
  },
];

export function WelcomeCarousel() {
  const router = useRouter();
  const [page, setPage] = useState(0);
  // Portal to <body>: the page renders inside <main> (z-0), whose stacking
  // context would pin the overlay UNDER the nav/bottom tabs no matter the
  // z-index. mounted gates SSR (no document on the server).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const last = page === PAGES.length - 1;

  function finish(dest: string) {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
    router.push(dest);
  }

  const p = PAGES[page];

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-end px-6 pt-3">
        <button
          onClick={() => finish("/login")}
          className={`text-sm font-medium text-muted ${last ? "invisible" : ""}`}
        >
          Skip
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="mb-8 min-h-[190px] w-full max-w-md content-center">{p.art}</div>
        <h1 className="font-heading text-[26px] font-bold leading-tight text-foreground">
          {p.headline}
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">{p.copy}</p>
      </div>

      <div className="mb-4 flex justify-center gap-2">
        {PAGES.map((_, i) => (
          <button
            key={i}
            aria-label={`Page ${i + 1}`}
            onClick={() => setPage(i)}
            className={`h-[7px] rounded-full transition-all ${i === page ? "w-[22px] bg-accent" : "w-[7px] bg-muted/35"}`}
          />
        ))}
      </div>

      <div className="mx-auto mb-9 w-full max-w-md px-7">
        {last ? (
          <div className="flex flex-col items-center gap-2.5">
            <button
              onClick={() => finish("/signup")}
              className="w-full rounded-full bg-accent py-3 text-base font-semibold text-[#18181b] hover:brightness-110 transition-all"
            >
              Create account
            </button>
            <button onClick={() => finish("/login")} className="py-1 text-[15px] font-medium text-neon-blue">
              I already have an account
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPage(page + 1)}
            className="w-full rounded-full bg-accent py-3 text-base font-semibold text-[#18181b] hover:brightness-110 transition-all"
          >
            Continue
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * Mounted in the root layout. On the FIRST launch of the installed app
 * (PWA standalone / Play-Store TWA) with no session, routes to /welcome.
 * Regular browser visits never see it (the landing page is the web funnel).
 */
export function OnboardingGate({ isLoggedIn }: { isLoggedIn: boolean }) {
  if (typeof window !== "undefined") {
    try {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari's non-standard flag
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (
        standalone &&
        !isLoggedIn &&
        !localStorage.getItem(SEEN_KEY) &&
        window.location.pathname !== "/welcome"
      ) {
        window.location.replace("/welcome");
      }
    } catch {}
  }
  return null;
}
