"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import type { TbrSuggestion } from "@/lib/queries/tbr-suggestion";
import { NoCover } from "@/components/no-cover";

interface TbrSuggestionCardProps {
  initialBook: TbrSuggestion | null;
}

export function TbrSuggestionCard({ initialBook }: TbrSuggestionCardProps) {
  const [book, setBook] = useState(initialBook);
  const [isShuffling, startTransition] = useTransition();

  function handleShuffle() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/tbr-suggestion");
        if (res.ok) {
          const data = await res.json();
          setBook(data);
        }
      } catch {
        // ignore
      }
    });
  }

  if (!book) {
    return (
      <div className="rounded-[18px] border border-foreground/10 bg-surface/60 p-6 text-center">
        <p className="text-sm text-muted">
          No owned TBR books yet.{" "}
          <Link href="/search" className="font-medium text-neon-blue hover:text-neon-blue/80">
            Find books to add
          </Link>
        </p>
      </div>
    );
  }

  const href = `/book/${book.slug || book.id}`;

  // Designed, not just matched (Rebekah, 2026-11-16): the pick sits on its own
  // cover art like the Reading Now and Up Next cards around it, inside the
  // wordmark-colour hairline the hero cards use, with the cover tipped as if
  // just pulled off the shelf. The reason is a glass badge; shuffling is a
  // real button, not a strip along the bottom.
  return (
    <div
      className="rounded-[22px] p-px"
      style={{
        background:
          "linear-gradient(135deg, rgba(163,230,53,0.55), rgba(56,189,248,0.35), rgba(192,132,252,0.45))",
      }}
    >
      <div className="relative overflow-hidden rounded-[21px] bg-surface">
        {book.coverImageUrl && (
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <Image
              src={book.coverImageUrl}
              alt=""
              fill
              sizes="(max-width: 1024px) 100vw, 512px"
              className="book-card-bg-img scale-150 object-cover"
            />
            <div className="absolute inset-0 currently-reading-overlay" />
          </div>
        )}
        <div className={`relative flex items-center justify-center gap-4 p-4 lg:gap-5 lg:p-5 transition-opacity ${isShuffling ? "opacity-60" : ""}`}>
          <Link href={href} className="flex-shrink-0 -rotate-3 transition-transform duration-200 hover:rotate-0">
            {book.coverImageUrl ? (
              <Image
                src={book.coverImageUrl}
                alt={`Cover of ${book.title}`}
                width={87}
                height={130}
                className="h-[120px] w-[80px] lg:h-[138px] lg:w-[92px] rounded-lg object-cover shadow-[0_10px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/10"
              />
            ) : (
              <NoCover title={book.title} className="h-[120px] w-[80px] lg:h-[138px] lg:w-[92px] shadow-xl" size="md" />
            )}
          </Link>
          {/* Not flex-1: the cover and text sit as one group in the middle of
              the card instead of hugging its left edge (Rebekah, 2026-11-16). */}
          <div className="min-w-0">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-foreground/10 bg-surface/80 px-2.5 py-1 text-[11px] font-semibold text-foreground backdrop-blur-md">
              <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-accent" />
              <span className="truncate">{book.reason || "From your TBR"}</span>
            </span>
            <Link href={href} className="block">
              <h3 className="mt-2 font-heading text-[19px] font-bold leading-tight book-header-text line-clamp-2">{book.title}</h3>
              {book.authors.length > 0 && (
                <p className="mt-0.5 text-sm book-header-text-sub line-clamp-1">{book.authors.join(", ")}</p>
              )}
            </Link>
            <button
              onClick={handleShuffle}
              disabled={isShuffling}
              className="btn-glass mt-3 cursor-pointer px-3.5 py-1.5 text-xs disabled:opacity-60"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`text-neon-blue ${isShuffling ? "animate-spin" : ""}`} aria-hidden="true">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
              {isShuffling ? "Shuffling…" : "Show me another"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
