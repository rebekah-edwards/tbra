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
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-sm text-muted">
          No owned TBR books yet.{" "}
          <Link href="/search" className="text-primary hover:text-primary-dark">
            Find books to add
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden lg:flex">
      <Link href={`/book/${book.slug || book.id}`} className="flex items-center gap-4 p-4 lg:p-5 lg:flex-1 min-w-0">
        {book.coverImageUrl ? (
          <Image
            src={book.coverImageUrl}
            alt={`Cover of ${book.title}`}
            width={70}
            height={105}
            className="h-[105px] w-[70px] lg:h-[130px] lg:w-[87px] rounded-lg object-cover shadow-md flex-shrink-0"
          />
        ) : (
          <NoCover title={book.title} className="h-[105px] w-[70px] lg:h-[130px] lg:w-[87px] shadow-md flex-shrink-0" size="md" />
        )}
        <div className="min-w-0 flex-1">
          {book.reason ? (
            <p className="text-[10px] font-medium uppercase tracking-wider text-primary mb-1">{book.reason}</p>
          ) : (
            <p className="text-[10px] font-medium uppercase tracking-wider text-primary mb-1">From Your TBR</p>
          )}
          <h3 className="text-base font-bold leading-tight line-clamp-2">{book.title}</h3>
          {book.authors.length > 0 && (
            <p className="mt-0.5 text-sm text-muted line-clamp-1">{book.authors.join(", ")}</p>
          )}
        </div>
      </Link>
      <button
        onClick={handleShuffle}
        disabled={isShuffling}
        className="w-full lg:w-auto border-t border-border px-4 py-2.5 flex items-center justify-center lg:border-t-0 lg:border-l lg:px-6 text-xs font-medium text-muted hover:text-primary hover:bg-surface-alt/50 transition-colors disabled:opacity-50 cursor-pointer gap-1.5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
          <line x1="4" y1="4" x2="9" y2="9" />
        </svg>
        {isShuffling ? "Shuffling..." : "Show me another"}
      </button>
    </div>
  );
}
