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
    // Design refresh 2026-11 (mirrors iOS SummaryQuoteCard bodyV2): the
    // one-line hook set as a headline on glass, with a hairline in the logo's
    // lime → blue → purple. Replaces the edge-bleed grey card and the
    // oversized serif quotation mark. Same footprint on mobile and desktop.
    return (
      <div className={layout === "mobile" ? "py-2" : "py-2"}>
        <div
          className="relative rounded-[22px] p-px"
          style={{
            background:
              "linear-gradient(135deg, rgba(163,230,53,0.55), rgba(56,189,248,0.35), rgba(192,132,252,0.45))",
          }}
        >
          <div className="rounded-[21px] bg-surface/85 backdrop-blur-xl p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-muted">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2l1.9 5.6a3 3 0 0 0 1.9 1.9L21.4 11.4l-5.6 1.9a3 3 0 0 0-1.9 1.9L12 20.8l-1.9-5.6a3 3 0 0 0-1.9-1.9L2.6 11.4l5.6-1.9a3 3 0 0 0 1.9-1.9L12 2z" />
              </svg>
              THE SHORT VERSION
            </p>
            <p className="mt-2.5 font-heading text-[17px] font-semibold leading-snug text-foreground text-left">
              {summary}
            </p>
          </div>
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
