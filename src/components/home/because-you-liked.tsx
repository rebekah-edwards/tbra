"use client";

import { BookCard } from "@/components/book-card";
import type { RecommendedBook } from "@/lib/queries/recommendations";

interface BecauseYouLikedProps {
  suggestions: {
    seed: { id: string; title: string };
    books: RecommendedBook[];
  }[];
}

export function BecauseYouLiked({ suggestions }: BecauseYouLikedProps) {
  if (suggestions.length === 0) return null;

  return (
    <>
      {suggestions.map(({ seed, books }) => (
        <section key={seed.id}>
          <h2
            className="section-heading text-sm lg:text-sm mb-3 lg:mb-2"
          >
            Because You Liked{" "}
            <span className="normal-case italic text-foreground/80">
              {seed.title}
            </span>
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 pr-12 no-scrollbar mask-fade-right">
            {books.map((book) => (
              <div key={book.id} className="w-[130px] flex-shrink-0">
                <BookCard
                  id={book.id}
                  slug={book.slug}
                  title={book.title}
                  coverImageUrl={book.coverImageUrl}
                  authors={book.authors}
                  aggregateRating={book.aggregateRating}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
