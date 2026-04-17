"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { NoCover } from "@/components/no-cover";

interface SimilarBook {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  reason?: string;
}

export function SimilarBooks({ bookId }: { bookId: string }) {
  const [books, setBooks] = useState<SimilarBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/books/similar?bookId=${bookId}`);
        if (!res.ok) throw new Error("fetch failed");
        const data: SimilarBook[] = await res.json();
        if (!cancelled) setBooks(data);
      } catch {
        if (!cancelled) setBooks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [bookId]);

  if (loading) {
    return (
      <section className="mt-8">
        <h2 className="section-heading text-xl">
          Similar Books
        </h2>
        <div className="mt-4 flex gap-3 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="w-[120px] flex-shrink-0 animate-pulse">
              <div className="aspect-[2/3] rounded bg-surface-alt" />
              <div className="mt-2 h-3 w-3/4 rounded bg-surface-alt" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (books.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="section-heading text-xl">
        Similar Books
      </h2>
      {/* Single horizontally-scrolling row with fade hint on every
          viewport. The trailing padding must exceed the fade zone
          (15% of the visible container width). Mobile cards are
          narrow so pr-12 is enough; tablet/desktop cards are much
          wider so the fade zone balloons — bump to pr-32 at md:+. */}
      <div className="mt-4 flex gap-3 overflow-x-auto pb-2 no-scrollbar mask-fade-right pr-12 md:pr-32">
        {books.map((book) => (
          <Link
            key={book.id}
            href={`/book/${book.slug || book.id}`}
            className="group w-[120px] flex-shrink-0"
          >
            <div className="aspect-[2/3] relative rounded-lg overflow-hidden">
              {book.coverImageUrl ? (
                <Image
                  src={book.coverImageUrl}
                  alt={`Cover of ${book.title}`}
                  fill
                  sizes="120px"
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              ) : (
                <NoCover title={book.title} className="w-full h-full" />
              )}
            </div>
            {book.reason && (
              <p className="mt-1.5 text-center text-[10px] leading-snug text-muted/70 italic line-clamp-3">
                {book.reason}
              </p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
