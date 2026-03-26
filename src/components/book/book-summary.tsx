"use client";

/**
 * BookSummary — AI-generated summary display
 *
 * Design variants (swap via `variant` prop):
 *   "blob"    — Pull-quote with oversized quotation mark + warm gradient accent (Option-Blob)
 *   "frosted" — Frosted glass card with slow-breathing blob pulse (Option-Frosted)
 *   "wash"    — Ink-wash fade-in with watercolor gradient bleed (Option-Wash)
 *   "orb"     — Ambient radial orb drifting behind the text (Option-Orb)
 */

export type SummaryVariant = "blob" | "frosted" | "wash" | "orb";

interface BookSummaryProps {
  summary: string;
  variant?: SummaryVariant;
  /** "mobile" renders full-bleed edge-to-edge; "desktop" renders inline */
  layout?: "mobile" | "desktop";
}

export function BookSummary({
  summary,
  variant = "blob",
  layout = "mobile",
}: BookSummaryProps) {
  if (!summary) return null;

  const aiTag = (
    <span className="inline-flex items-center gap-1 text-[10px] tracking-wide uppercase text-foreground/30 font-medium mt-3">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      AI-generated summary
    </span>
  );

  if (variant === "blob") {
    const isFullBleed = layout === "mobile";
    return (
      <div
        className={
          isFullBleed
            ? "summary-blob -mt-2 -mb-6 mx-[calc(-50vw+50%)] px-[calc(50vw-50%)] py-10"
            : "summary-blob py-2"
        }
      >
        {/* Large quotation mark accent */}
        <div className="relative">
          <span
            className="summary-quote-mark absolute -top-3 -left-1 text-6xl leading-none font-heading select-none pointer-events-none"
            aria-hidden="true"
          >
            &ldquo;
          </span>
          <p
            className={`${
              isFullBleed ? "text-center px-6" : "text-left pl-8"
            } text-sm leading-relaxed text-foreground/70 italic`}
          >
            {summary}
          </p>
          {isFullBleed && (
            <span
              className="summary-quote-mark absolute -bottom-4 right-4 text-6xl leading-none font-heading select-none pointer-events-none"
              aria-hidden="true"
            >
              &rdquo;
            </span>
          )}
        </div>
        <div className={isFullBleed ? "text-center" : "pl-8"}>
          {aiTag}
        </div>
      </div>
    );
  }

  if (variant === "frosted") {
    return (
      <div
        className={
          layout === "mobile"
            ? "summary-frosted -mt-2 -mb-6 ml-[calc(-50vw+50%)] pr-[6%] py-10"
            : "summary-frosted py-2"
        }
      >
        <div
          className={`summary-frosted-card relative overflow-hidden backdrop-blur-xl p-6 border border-white/[0.06] ${
            layout === "mobile"
              ? "rounded-r-2xl pl-[calc(50vw-50%+1rem)]"
              : "rounded-2xl"
          }`}
        >
          {/* Breathing blob behind the card */}
          <div className="summary-frosted-blob absolute inset-0 pointer-events-none" aria-hidden="true" />
          {/* Oversized decorative quote — intentionally overflows the card, behind text */}
          <span
            className="absolute top-[calc(100%-90px)] right-[-15px] text-[280px] leading-none select-none pointer-events-none summary-frosted-quote z-0"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            aria-hidden="true"
          >
            &rdquo;
          </span>
          <p
            className={`relative z-10 text-sm leading-relaxed text-foreground/70 ${
              layout === "mobile" ? "text-left pr-8" : "text-left"
            }`}
          >
            {summary}
          </p>
        </div>
      </div>
    );
  }

  if (variant === "wash") {
    const isFullBleed = layout === "mobile";
    return (
      <div
        className={
          isFullBleed
            ? "summary-wash -mt-2 -mb-6 mx-[calc(-50vw+50%)] px-[calc(50vw-50%)] py-10"
            : "summary-wash py-2"
        }
      >
        <div className="summary-wash-inner relative">
          <p
            className={`text-sm leading-relaxed text-foreground/70 ${
              isFullBleed ? "text-center px-6" : "text-left"
            }`}
          >
            {summary}
          </p>
          <div className={isFullBleed ? "text-center" : ""}>
            {aiTag}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "orb") {
    const isFullBleed = layout === "mobile";
    return (
      <div
        className={
          isFullBleed
            ? "summary-orb -mt-2 -mb-6 mx-[calc(-50vw+50%)] px-[calc(50vw-50%)] py-10 relative overflow-hidden"
            : "summary-orb py-2 relative overflow-hidden"
        }
      >
        {/* Drifting orb */}
        <div className="summary-orb-glow absolute pointer-events-none" aria-hidden="true" />
        <p
          className={`relative z-10 text-sm leading-relaxed text-foreground/70 ${
            isFullBleed ? "text-center px-6" : "text-left"
          }`}
        >
          {summary}
        </p>
        <div className={`relative z-10 ${isFullBleed ? "text-center" : ""}`}>
          {aiTag}
        </div>
      </div>
    );
  }

  return null;
}
