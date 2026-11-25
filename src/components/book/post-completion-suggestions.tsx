"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { fetchPostCompletionSuggestions } from "@/lib/actions/recommendations";
import { addToTbr } from "@/lib/actions/reading-state";
import type { RecommendedBook } from "@/lib/queries/recommendations";
import { NoCover } from "@/components/no-cover";
import { AuthorLinks } from "@/components/book/author-links";

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
      <div className="relative w-full max-w-lg mb-16 sm:mb-0 rounded-t-[28px] bg-background border-t border-foreground/10 p-5 pb-8 animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="eyebrow">You finished it</p>
            <h3 className="font-heading text-lg font-bold leading-tight text-foreground">What to Read Next</h3>
          </div>
          <button onClick={onDismiss} aria-label="Close" className="orb-glass h-9 w-9 text-muted hover:text-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        )}

        {hasContent && (
          <div className="space-y-5 max-h-[60vh] overflow-y-auto">
            {/* Series continuation — top priority */}
            {seriesNext && (
              <div>
                <p className="eyebrow mb-2">Continue the Series</p>
                <SuggestionCard
                  featured
                  book={seriesNext}
                  added={addedIds.has(seriesNext.id)}
                  onAddToTbr={handleAddToTbr}
                />
              </div>
            )}

            {/* Similar books */}
            {similarBooks.length > 0 && (
              <div>
                <p className="eyebrow mb-2">Similar Books</p>
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
  featured = false,
}: {
  book: RecommendedBook;
  added: boolean;
  onAddToTbr: (id: string) => void;
  /** The series pick: on its own blurred cover art, with the sheet's one lime button. */
  featured?: boolean;
}) {
  return (
    <div className={`relative flex items-center gap-3 overflow-hidden p-3 ${featured ? "rounded-[18px] border border-foreground/10 bg-surface" : "row-glass"}`}>
      {featured && book.coverImageUrl && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <Image src={book.coverImageUrl} alt="" fill sizes="512px" className="book-card-bg-img scale-150 object-cover" />
          <div className="absolute inset-0 currently-reading-overlay" />
        </div>
      )}
      <Link href={`/book/${book.slug || book.id}`} className={`relative flex-shrink-0 ${featured ? "-rotate-3" : ""}`}>
        {book.coverImageUrl ? (
          <Image
            src={book.coverImageUrl}
            alt={`Cover of ${book.title}`}
            width={featured ? 52 : 40}
            height={featured ? 78 : 60}
            className={`${featured ? "h-[78px] w-[52px]" : "h-[60px] w-[40px]"} rounded-md object-cover shadow-[0_6px_14px_rgba(0,0,0,0.4)] ring-1 ring-white/10`}
          />
        ) : (
          <NoCover title={book.title} className="h-[60px] w-[40px]" size="sm" />
        )}
      </Link>

      <div className="relative min-w-0 flex-1">
        <Link href={`/book/${book.slug || book.id}`}>
          <h4 className={`font-heading text-[15px] font-bold leading-tight line-clamp-2 hover:text-neon-blue transition-colors ${featured ? "book-header-text" : "text-foreground"}`}>
            {book.title}
          </h4>
        </Link>
        {book.authors.length > 0 && (
          <p className={`text-xs line-clamp-1 mt-0.5 ${featured ? "book-header-text-sub" : "text-muted"}`}>
            <AuthorLinks authors={book.authors} />
          </p>
        )}
        {book.reason && (
          <span className="chip-glass mt-1.5 !text-[10px]">
            <span className="dot bg-neon-blue" />
            <span className="line-clamp-1">{book.reason}</span>
          </span>
        )}
      </div>

      <button
        onClick={() => !added && onAddToTbr(book.id)}
        disabled={added}
        data-active={added ? "true" : undefined}
        className={`relative flex-shrink-0 px-3.5 py-1.5 text-xs ${added ? "btn-glass cursor-default" : featured ? "btn-lime" : "btn-glass"}`}
      >
        {added ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true" className={featured ? "" : "text-accent"}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
        {added ? "Added" : "TBR"}
      </button>
    </div>
  );
}
