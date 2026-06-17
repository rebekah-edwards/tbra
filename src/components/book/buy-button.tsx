"use client";

import { useState } from "react";

interface BuyButtonProps {
  bookTitle: string;
  amazonUrl?: string | null;
  isbn13?: string | null;
  asin?: string | null;
}

// Amazon Associates tracking ID. Set NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG in the
// environment to swap in a fresh tracking ID without a code change (Amazon does
// not re-review rejected apps — each reapplication needs a fresh tag).
const ASSOCIATE_TAG = process.env.NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG || "tbra08-20";

/** Append the affiliate tag to any Amazon URL that doesn't already carry it. */
function withTag(url: string): string {
  if (/[?&]tag=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + `tag=${ASSOCIATE_TAG}`;
}

function buildAmazonLink({ amazonUrl, asin, isbn13, bookTitle }: BuyButtonProps): string {
  if (amazonUrl) return withTag(amazonUrl);
  if (asin) return `https://www.amazon.com/dp/${asin}?tag=${ASSOCIATE_TAG}`;
  if (isbn13) return `https://www.amazon.com/s?k=${isbn13}&tag=${ASSOCIATE_TAG}`;
  return `https://www.amazon.com/s?k=${encodeURIComponent(bookTitle)}&tag=${ASSOCIATE_TAG}`;
}

/**
 * Buy button that links to Amazon with the affiliate tag.
 *
 * IMPORTANT (Amazon Associates compliance): the tagged Amazon URL is rendered as
 * a real <a href> in the INITIAL markup — so it appears in the server-rendered
 * HTML / "View Source" that Amazon's reviewer scans. (Previously the tagged link
 * only existed inside the click-opened dialog, so it was absent from the static
 * HTML and Amazon reported "no tracking link" → rejection.)
 *
 * The click is intercepted to show an affiliate-disclosure interstitial before
 * navigating; the dialog's "Continue" uses the same href.
 */
export function BuyButton(props: BuyButtonProps) {
  const { bookTitle } = props;
  const [showDialog, setShowDialog] = useState(false);
  const amazonLink = buildAmazonLink(props);

  return (
    <>
      <a
        href={amazonLink}
        target="_blank"
        rel="sponsored noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          setShowDialog(true);
        }}
        className="flex flex-col items-center justify-center rounded-xl border-2 border-border hover:bg-muted/10 transition-colors px-3 shrink-0 self-stretch gap-0.5"
        title="Buy on Amazon"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted"
        >
          <path d="M4 7h16a1 1 0 0 1 1 1v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a1 1 0 0 1 1-1z" />
          <path d="M8 7V5a4 4 0 0 1 8 0v2" />
        </svg>
        <span className="text-[8px] text-muted/50 leading-none">Buy</span>
      </a>

      {showDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-xs rounded-2xl bg-surface border border-border p-5 shadow-2xl">
            <h3 className="text-base font-bold text-foreground text-center mb-2">
              Leaving tbr*a
            </h3>
            <p className="text-sm text-muted text-center mb-4 leading-relaxed">
              You&apos;re about to visit Amazon to view this book. As an Amazon Associate, tbr*a earns a small commission from qualifying purchases at no extra cost to you.
            </p>
            <div className="flex flex-col gap-2">
              <a
                href={amazonLink}
                target="_blank"
                rel="sponsored noopener noreferrer"
                onClick={() => setShowDialog(false)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-accent text-black text-center hover:brightness-110 transition-all"
              >
                Continue to Amazon
              </a>
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
