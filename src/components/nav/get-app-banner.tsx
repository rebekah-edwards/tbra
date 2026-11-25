"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  detectPlatform,
  downloadHref,
  type DevicePlatform,
  type StoreAvailability,
} from "@/lib/app-links";

const DISMISS_KEY = "get-app-banner-dismissed";
// Dismissing hides it for a week, not forever — a returning visitor gets one
// more nudge later.
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

// Pages where the banner would get in the way of the thing the visitor came
// to do (signing up, signing in) or would repeat itself (/download).
const HIDDEN_ON = ["/download", "/login", "/signup", "/welcome", "/forgot-password", "/reset-password", "/verify-email"];

/**
 * Logged-out phone visitors in a normal browser get a slim "Get the app" bar
 * pinned to the bottom edge (where signed-in readers have the tab bar). It
 * never shows inside the installed web app / Play Store app, on desktop, or
 * once dismissed.
 */
export function GetAppBanner() {
  const pathname = usePathname();
  const [platform, setPlatform] = useState<DevicePlatform | null>(null);
  const [href, setHref] = useState("/download");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Browser-only facts (display mode, user agent, storage), read after
    // hydration in a frame callback so server and client markup agree.
    const frame = requestAnimationFrame(() => {
      try {
        const standalone =
          window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as unknown as { standalone?: boolean }).standalone === true;
        if (standalone) return;
        const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
        if (dismissedAt && Date.now() - dismissedAt < DISMISS_MS) return;
      } catch {}

      let p = detectPlatform(navigator.userAgent);
      // iPadOS Safari reports itself as a Mac.
      if (p === "other" && /macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1) p = "ios";
      setPlatform(p);
      setVisible(true);

      fetch("/api/app-links")
        .then((r) => (r.ok ? r.json() : null))
        .then((stores: StoreAvailability | null) => {
          if (stores) setHref(downloadHref(p, stores));
        })
        .catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!visible || !platform || HIDDEN_ON.some((p) => pathname?.startsWith(p))) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
  };

  const external = href.startsWith("http");

  return (
    <div
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 px-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)" }}
      role="region"
      aria-label="Get the tbr*a app"
    >
      <div className="card-hairline flex items-center gap-3 px-3 py-2.5 shadow-lg backdrop-blur-xl">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-[10px]"
        />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold leading-tight text-foreground">
            Get the tbr*a app
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            Free on iPhone &amp; Android
          </p>
        </div>
        <a
          href={href}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="btn-lime shrink-0 px-4 py-1.5 text-xs"
        >
          Get the app
        </a>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 shrink-0 p-1 text-muted/70 hover:text-foreground"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
