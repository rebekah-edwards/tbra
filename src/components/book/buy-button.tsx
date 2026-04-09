"use client";

import { useState } from "react";

interface BuyButtonProps {
  bookTitle: string;
  amazonUrl?: string | null;
  isbn13?: string | null;
  asin?: string | null;
}

/**
 * Buy button that links to Amazon with affiliate tag.
 * Shows a shopping bag icon. Tapping opens a confirmation dialog
 * with affiliate disclosure before navigating to Amazon.
 */
export function BuyButton({ bookTitle, amazonUrl, isbn13, asin }: BuyButtonProps) {
  const ASSOCIATE_TAG = "tbra08-20";
  const [showDialog, setShowDialog] = useState(false);

  const getAmazonLink = () => {
    if (amazonUrl) return amazonUrl;
    if (asin) return `https://www.amazon.com/dp/${asin}?tag=${ASSOCIATE_TAG}`;
    if (isbn13) return `https://www.amazon.com/s?k=${isbn13}&tag=${ASSOCIATE_TAG}`;
    return `https://www.amazon.com/s?k=${encodeURIComponent(bookTitle)}&tag=${ASSOCIATE_TAG}`;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
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
      </button>

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
                href={getAmazonLink()}
                target="_blank"
                rel="noopener noreferrer"
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
