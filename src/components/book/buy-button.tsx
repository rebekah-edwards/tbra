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
 * Shows a shopping bag icon with "Buy" label.
 * If we have a direct Amazon URL (from PA-API), use it.
 * Otherwise, construct a search URL from ISBN or title.
 */
export function BuyButton({ bookTitle, amazonUrl, isbn13, asin }: BuyButtonProps) {
  const ASSOCIATE_TAG = "tbra-20";

  // Build the best Amazon link we can
  const getAmazonLink = () => {
    if (amazonUrl) return amazonUrl;
    if (asin) return `https://www.amazon.com/dp/${asin}?tag=${ASSOCIATE_TAG}`;
    if (isbn13) return `https://www.amazon.com/dp/${isbn13}?tag=${ASSOCIATE_TAG}`;
    return `https://www.amazon.com/s?k=${encodeURIComponent(bookTitle)}&i=stripbooks&tag=${ASSOCIATE_TAG}`;
  };

  return (
    <a
      href={getAmazonLink()}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center rounded-xl border-2 border-border hover:bg-muted/10 transition-colors px-3 shrink-0 self-stretch"
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
        {/* Shopping bag with handles above the bag */}
        <path d="M4 7h16a1 1 0 0 1 1 1v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a1 1 0 0 1 1-1z" />
        <path d="M8 7V5a4 4 0 0 1 8 0v2" />
      </svg>
    </a>
  );
}
