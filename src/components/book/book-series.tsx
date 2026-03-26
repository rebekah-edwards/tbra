"use client";

import { useRef, useEffect } from "react";
import Link from "next/link";
import { NoCover } from "@/components/no-cover";


interface SeriesBook {
  id: string;
  slug?: string | null;
  title: string;
  coverImageUrl: string | null;
  position: number | null;
  userRating: number | null;
}

interface BookSeriesProps {
  seriesId: string;
  seriesSlug?: string | null;
  name: string;
  books: SeriesBook[];
  currentBookId: string;
}

export function BookSeries({ seriesId, seriesSlug, name, books, currentBookId }: BookSeriesProps) {
  // Show only core books (integer positions) — novellas and .5 entries clutter the horizontal scroll
  const coreBooks = books.filter(
    (b) => b.position != null && Number.isInteger(b.position)
  );
  // Fall back to all books if filtering leaves nothing (or if current book would be excluded)
  const displayBooks = coreBooks.length > 0 && coreBooks.some((b) => b.id === currentBookId || b.position !== null)
    ? coreBooks
    : books;

  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to center the current book on mobile; start from book 1 on desktop
  useEffect(() => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    if (isDesktop) {
      container.scrollLeft = 0;
      return;
    }
    const currentEl = container.querySelector<HTMLElement>("[data-current-book]");
    if (!currentEl) return;
    const scrollLeft = currentEl.offsetLeft - container.clientWidth / 2 + currentEl.offsetWidth / 2;
    container.scrollLeft = Math.max(0, scrollLeft);
  }, [currentBookId]);

  if (displayBooks.length === 0) return null;

  return (
    <section className="mt-8 overflow-hidden">
      <h2 className="section-heading text-xl">More In This Series</h2>
      <div ref={scrollRef} className="mt-4 flex gap-3 lg:gap-2 overflow-x-auto px-1 py-1 pb-2 pr-12 no-scrollbar mask-fade-right">
        {displayBooks.map((book) => {
          const isCurrent = book.id === currentBookId;
          return (
            <Link
              key={book.id}
              href={`/book/${book.slug || book.id}`}
              data-current-book={isCurrent ? "" : undefined}
              className={`group flex-shrink-0 ${isCurrent ? "opacity-100" : "opacity-80 hover:opacity-100"} transition-opacity`}
            >
              <div className={`relative w-[120px] ${isCurrent ? "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-lg" : ""}`}>
                {book.coverImageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={book.coverImageUrl}
                    alt={`Cover of ${book.title}`}
                    className="aspect-[2/3] w-[120px] rounded-lg object-cover shadow-sm"
                    loading="lazy"
                  />
                ) : (
                  <NoCover title={book.title} className="aspect-[2/3] w-[120px] shadow-sm" size="md" />
                )}
                {book.userRating != null && book.userRating > 0 && (
                  <div className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/70 backdrop-blur-sm px-1.5 py-0.5">
                    <span className="text-[10px] font-semibold text-white/90">
                      {book.userRating % 0.25 === 0 && book.userRating % 0.5 !== 0
                        ? book.userRating.toFixed(2)
                        : book.userRating.toFixed(1)}
                    </span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="#facc15" stroke="none">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs font-medium text-muted">
                Book {book.position ?? "?"}
              </p>
            </Link>
          );
        })}
      </div>

      <Link
        href={seriesSlug ? `/series/${seriesSlug}` : `/search?series=${encodeURIComponent(seriesId)}`}
        className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-neon-purple text-white py-3 px-5 text-sm font-semibold shadow-[0_0_16px_rgba(192,132,252,0.3)] hover:brightness-110 transition-all max-w-full"
      >
        View all books in this series
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>
    </section>
  );
}
