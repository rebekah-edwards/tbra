"use client";

import Image from "next/image";
import Link from "next/link";
import { ReadingStateButton } from "@/components/reading-state-button";
import { CompactOwnedButton } from "@/components/compact-owned-button";
import { StarRow } from "@/components/review/rounded-star";
import { useState } from "react";

interface SeriesBook {
  id: string;
  title: string;
  coverImageUrl: string | null;
  position: number | null;
  authors: string[];
  userRating: number | null;
  currentState: string | null;
  ownedFormats: string[];
}

interface SeriesBooksViewProps {
  seriesName: string;
  books: SeriesBook[];
  isLoggedIn: boolean;
}

export function SeriesBooksView({ seriesName, books, isLoggedIn }: SeriesBooksViewProps) {
  const [bookStates, setBookStates] = useState<Record<string, string | null>>(
    () => Object.fromEntries(books.map((b) => [b.id, b.currentState]))
  );
  const [bookOwnedFormats, setBookOwnedFormats] = useState<Record<string, string[]>>(
    () => Object.fromEntries(books.map((b) => [b.id, b.ownedFormats]))
  );

  return (
    <div>
      <Link href="/search" className="text-sm text-primary hover:text-primary/80 mb-4 inline-block">
        &larr; Back to search
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">{seriesName}</h1>
      <p className="mt-2 text-muted text-sm">{books.length} book{books.length !== 1 ? "s" : ""} in this series</p>

      <div className="mt-6 space-y-3">
        {books.map((book) => (
          <div
            key={book.id}
            className="flex gap-4 rounded-lg border border-border bg-surface p-4"
          >
            <Link href={`/book/${book.id}`} className="flex-shrink-0">
              {book.coverImageUrl ? (
                <Image
                  src={book.coverImageUrl}
                  alt={`Cover of ${book.title}`}
                  width={60}
                  height={90}
                  className="h-[90px] w-[60px] rounded object-cover hover:opacity-80 transition-opacity"
                />
              ) : (
                <div className="flex h-[90px] w-[60px] items-center justify-center rounded bg-surface-alt text-xs text-muted">
                  No cover
                </div>
              )}
            </Link>
            <div className="flex flex-1 flex-col justify-between">
              <div>
                <Link href={`/book/${book.id}`}>
                  <h3 className="font-medium leading-tight hover:text-primary transition-colors">
                    {book.title}
                  </h3>
                </Link>
                {book.position && (
                  <p className="text-xs text-muted">Book {book.position}</p>
                )}
                {book.authors.length > 0 && (
                  <p className="mt-0.5 text-sm text-muted">
                    {book.authors.join(", ")}
                  </p>
                )}
                {book.userRating != null && book.userRating > 0 && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <StarRow rating={book.userRating} size={14} />
                    <span className="text-xs font-medium text-foreground/70">
                      {book.userRating % 0.25 === 0 && book.userRating % 0.5 !== 0
                        ? book.userRating.toFixed(2)
                        : book.userRating.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <ReadingStateButton
                  bookId={book.id}
                  currentState={bookStates[book.id] ?? null}
                  isLoggedIn={isLoggedIn}
                  compact
                  onStateChange={(newState) => {
                    setBookStates((prev) => ({ ...prev, [book.id]: newState }));
                  }}
                />
                <CompactOwnedButton
                  bookId={book.id}
                  currentFormats={bookOwnedFormats[book.id] ?? []}
                  isLoggedIn={isLoggedIn}
                  onFormatsChange={(formats) => {
                    setBookOwnedFormats((prev) => ({ ...prev, [book.id]: formats }));
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
