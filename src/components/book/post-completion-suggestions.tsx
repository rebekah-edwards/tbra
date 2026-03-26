"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { fetchPostCompletionSuggestions } from "@/lib/actions/recommendations";
import { addToTbr } from "@/lib/actions/reading-state";
import type { RecommendedBook } from "@/lib/queries/recommendations";
import { NoCover } from "@/components/no-cover";

interface PostCompletionSuggestionsProps {
  bookId: string;
  show: boolean;
  onDismiss: () => void;
}

export function PostCompletionSuggestions({
  bookId,
  show,
  onDismiss,
}: PostCompletionSuggestionsProps) {
  const [seriesNext, setSeriesNext] = useState<RecommendedBook | null>(null);
  const [similarBooks, setSimilarBooks] = useState<RecommendedBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!show) return;

    let cancelled = false;
    setLoading(true);

    fetchPostCompletionSuggestions(bookId).then((data) => {
      if (cancelled || !data) {
        setLoading(false);
        return;
      }
      setSeriesNext(data.seriesNext);
      setSimilarBooks(data.similarBooks);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [show, bookId]);

  const handleAddToTbr = useCallback(async (id: string) => {
    await addToTbr(id);
    setAddedIds((prev) => new Set([...prev, id]));
  }, []);

  if (!show) return null;

  const hasContent = !loading && (seriesNext || similarBooks.length > 0);
  const isEmpty = !loading && !seriesNext && similarBooks.length === 0;

  if (isEmpty) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onDismiss}
      />

      {/* Bottom sheet */}
      <div className="relative w-full max-w-lg mb-16 sm:mb-0 rounded-t-2xl bg-background border-t border-border p-5 pb-8 animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center justify-between mb-4">
          <h3
            className="section-heading text-sm"
          >
            What to Read Next
          </h3>
          <button
            onClick={onDismiss}
            className="text-muted hover:text-foreground text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {hasContent && (
          <div className="space-y-5 max-h-[60vh] overflow-y-auto">
            {/* Series continuation — top priority */}
            {seriesNext && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wide mb-2">
                  Continue the Series
                </p>
                <SuggestionCard
                  book={seriesNext}
                  added={addedIds.has(seriesNext.id)}
                  onAddToTbr={handleAddToTbr}
                />
              </div>
            )}

            {/* Similar books */}
            {similarBooks.length > 0 && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wide mb-2">
                  Similar Books
                </p>
                <div className="space-y-2">
                  {similarBooks.slice(0, 6).map((book) => (
                    <SuggestionCard
                      key={book.id}
                      book={book}
                      added={addedIds.has(book.id)}
                      onAddToTbr={handleAddToTbr}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  book,
  added,
  onAddToTbr,
}: {
  book: RecommendedBook;
  added: boolean;
  onAddToTbr: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
      <Link href={`/book/${book.slug || book.id}`} className="flex-shrink-0">
        {book.coverImageUrl ? (
          <Image
            src={book.coverImageUrl}
            alt={`Cover of ${book.title}`}
            width={40}
            height={60}
            className="h-[60px] w-[40px] rounded object-cover"
          />
        ) : (
          <NoCover title={book.title} className="h-[60px] w-[40px]" size="sm" />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={`/book/${book.slug || book.id}`}>
          <h4 className="text-sm font-semibold leading-tight line-clamp-1 hover:text-primary transition-colors">
            {book.title}
          </h4>
        </Link>
        {book.authors.length > 0 && (
          <p className="text-xs text-muted line-clamp-1 mt-0.5">
            {book.authors.join(", ")}
          </p>
        )}
        {book.reason && (
          <p className="text-[10px] text-primary/80 mt-0.5">{book.reason}</p>
        )}
      </div>

      <button
        onClick={() => !added && onAddToTbr(book.id)}
        disabled={added}
        className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
          added
            ? "bg-primary/10 text-primary cursor-default"
            : "bg-accent text-black hover:bg-accent/90"
        }`}
      >
        {added ? "Added" : "+ TBR"}
      </button>
    </div>
  );
}
