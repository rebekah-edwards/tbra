"use client";

// Web twin of the iOS guided-tour engine (AppShell.swift): dimmed overlay
// with an even-odd cutout around the current target, lime ring, arrowed
// card with Next/Skip, one-shot via localStorage `tour-<key>` (same key
// names as the iOS AppStorage so the copy stays in lockstep per platform).
// Targets are marked with data-coach-anchor="<id>" attributes. Activation
// WAITS for the first anchor to exist in the DOM — same fix as iOS, where
// a fixed delay spotlit thin air on data-loading screens.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export interface CoachStep {
  /** matches a data-coach-anchor attribute on the page */
  anchor: string;
  title: string;
  text: string;
}

interface GuidedTourProps {
  tourKey: string;
  steps: CoachStep[];
  /** turns the LAST step's primary button into a call to action */
  ctaLabel?: string;
  onCTA?: () => void;
  /** fires when a step becomes current (open accordions, etc.) */
  onStep?: (step: CoachStep, index: number) => void;
  /** set false to hold the tour (e.g. while a modal is up) */
  active?: boolean;
}

const ANCHOR_POLL_MS = 400;
const RING_PAD = 6;
const RING_RADIUS = 14;

function anchorEl(anchor: string): HTMLElement | null {
  // A selector can match a node still inside Next's HIDDEN streaming
  // container (zero-size, position 0,0) before React moves it into the live
  // tree — spotlighting that gives a ring in the top-left corner and a
  // scrollIntoView that no-ops. Only accept an element that is actually
  // laid out.
  const els = document.querySelectorAll<HTMLElement>(`[data-coach-anchor="${anchor}"]`);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Manual scroll (no scrollIntoView): mutating scroll-margin on server-
 *  rendered anchors caused hydration mismatches, and smooth programmatic
 *  scrolls are swallowed by the app's body scroller. Tall targets align
 *  their top under the nav; others center. */
function scrollToAnchor(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const tall = r.height > vh * 0.5;
  const target = tall
    ? window.scrollY + r.top - 84
    : window.scrollY + r.top - (vh - r.height) / 2;
  window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
}

export function GuidedTour({
  tourKey,
  steps,
  ctaLabel,
  onCTA,
  onStep,
  active = true,
}: GuidedTourProps) {
  const storageKey = `tour-${tourKey}`;
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(200);

  // Activation: skip if seen; otherwise poll until the first anchor renders.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    try {
      if (localStorage.getItem(storageKey)) return;
    } catch {
      return; // storage unavailable (private mode edge) — never loop the tour
    }
    // Poll until the anchor exists — no deadline. Streamed pages can land
    // their lower sections many seconds after this component hydrates, and
    // a capped poll silently loses the race (seen in dev on first compile).
    // The tour is one-shot, so an idle 400ms poll until unmount is cheap.
    const tick = () => {
      if (cancelled) return;
      if (anchorEl(steps[0].anchor)) {
        setIndex(0);
        return;
      }
      setTimeout(tick, ANCHOR_POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, storageKey]);

  // Step change: notify, let layout settle (accordion opens), scroll the
  // target into view, then start tracking its rect.
  useEffect(() => {
    if (index === null) return;
    const step = steps[index];
    onStep?.(step, index);
    // Deferred + repeated, mirroring iOS: a scroll issued in the same frame
    // as a layout change silently lands wrong, and late loads shift layout.
    const timers = [350, 900].map((delay) =>
      setTimeout(() => {
        const el = anchorEl(step.anchor);
        if (el) scrollToAnchor(el);
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Rect tracking while the overlay is up: scroll/resize + a slow interval
  // for layout shifts neither event reports (image loads, accordions).
  useEffect(() => {
    if (index === null) return;
    const step = steps[index];
    // Self-healing scroll: streamed content can shift layout AFTER the
    // step's initial scroll fired, leaving the target far off-screen. If the
    // ring is fully out of view, re-nudge (throttled so smooth scrolls and
    // the user's own scrolling aren't fought).
    let lastNudge = Date.now();
    const measure = () => {
      const el = anchorEl(step.anchor);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if ((r.top > window.innerHeight - 40 || r.bottom < 40) && Date.now() - lastNudge > 2000) {
        lastNudge = Date.now();
        scrollToAnchor(el);
      }
      setRect((prev) =>
        prev &&
        Math.abs(prev.top - r.top) < 1 &&
        Math.abs(prev.left - r.left) < 1 &&
        Math.abs(prev.width - r.width) < 1 &&
        Math.abs(prev.height - r.height) < 1
          ? prev
          : r
      );
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const interval = setInterval(measure, 250);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Track the card's real height so placement math uses actual size.
  useEffect(() => {
    if (index === null) return;
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 2) setCardH(h);
  });

  const finish = useCallback(
    (viaCTA: boolean) => {
      try {
        localStorage.setItem(storageKey, "1");
      } catch {
        /* ignore */
      }
      setIndex(null);
      if (viaCTA) onCTA?.();
    },
    [storageKey, onCTA]
  );

  // Escape skips, mirroring the card's Skip button.
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, finish]);

  if (index === null || !rect || !viewport) return null;

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const ringX = rect.left - RING_PAD;
  const ringY = rect.top - RING_PAD;
  const ringW = rect.width + RING_PAD * 2;
  // Tall targets (open accordions) get a clamped spotlight — top edge kept,
  // height capped — so the ring never swallows the whole screen (iOS parity).
  const ringH = Math.min(rect.height + RING_PAD * 2, viewport.h * 0.45);

  // Even-odd path: full viewport rect + rounded ring rect = cutout.
  const r = Math.min(RING_RADIUS, ringW / 2, ringH / 2);
  const cutout = [
    `M0 0H${viewport.w}V${viewport.h}H0Z`,
    `M${ringX + r} ${ringY}`,
    `H${ringX + ringW - r}`,
    `A${r} ${r} 0 0 1 ${ringX + ringW} ${ringY + r}`,
    `V${ringY + ringH - r}`,
    `A${r} ${r} 0 0 1 ${ringX + ringW - r} ${ringY + ringH}`,
    `H${ringX + r}`,
    `A${r} ${r} 0 0 1 ${ringX} ${ringY + ringH - r}`,
    `V${ringY + r}`,
    `A${r} ${r} 0 0 1 ${ringX + r} ${ringY}`,
    "Z",
  ].join(" ");

  const cardW = Math.min(360, viewport.w - 24);
  const cardLeft = Math.min(
    Math.max(12, rect.left + rect.width / 2 - cardW / 2),
    viewport.w - cardW - 12
  );
  const arrowX = Math.min(
    Math.max(rect.left + rect.width / 2 - cardLeft, 24),
    cardW - 24
  );

  // Placement against the CLAMPED ring: below when there's room, above when
  // the top has room, else pinned to the bottom edge (never off-screen).
  const spaceBelow = viewport.h - (ringY + ringH) - 18;
  const spaceAbove = ringY - 18;
  const placement: "below" | "above" | "pinned" =
    spaceBelow >= cardH + 12 ? "below" : spaceAbove >= cardH + 12 ? "above" : "pinned";
  const cardStyle: CSSProperties =
    placement === "below"
      ? { width: cardW, left: cardLeft, top: ringY + ringH + 18 }
      : placement === "above"
        ? { width: cardW, left: cardLeft, bottom: viewport.h - ringY + 18 }
        : { width: cardW, left: cardLeft, bottom: 12 };

  const overlay = (
    <div className="fixed inset-0 z-[999]" role="dialog" aria-label={step.title}>
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path d={cutout} fillRule="evenodd" fill="rgba(0,0,0,0.72)" />
        <rect
          x={ringX}
          y={ringY}
          width={ringW}
          height={ringH}
          rx={r}
          fill="none"
          stroke="#a3e635"
          strokeWidth="2"
        />
      </svg>

      <div
        ref={cardRef}
        className="absolute rounded-2xl border border-border bg-surface shadow-2xl p-5"
        style={cardStyle}
      >
        {/* Arrow toward the ring (omitted when pinned — nothing to point at) */}
        {placement !== "pinned" && (
          <div
            aria-hidden="true"
            className="absolute h-3.5 w-3.5 rotate-45 border-border bg-surface"
            style={{
              left: arrowX - 7,
              ...(placement === "above"
                ? { bottom: -8, borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }
                : { top: -8, borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)" }),
            }}
          />
        )}
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-bold text-foreground">{step.title}</h3>
          {steps.length > 1 && (
            <span className="text-xs text-muted shrink-0">
              {index + 1} of {steps.length}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-muted leading-relaxed">{step.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => finish(false)}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Skip tour
          </button>
          <button
            type="button"
            onClick={() => {
              if (isLast) {
                finish(!!ctaLabel);
              } else {
                setIndex(index + 1);
              }
            }}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-black hover:brightness-110 transition-all"
          >
            {isLast ? (ctaLabel ?? "Done") : "Next"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
