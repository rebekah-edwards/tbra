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
      {/* Mobile = scroll + fade hint. Any viewport wide enough to fit
          the grid (md:+) drops the fade and right padding so the last
          column is fully visible. The `!` forces the override above the
          .mask-fade-right custom class, which CSS ordering otherwise
          lets win. */}
      <div className="mt-4 flex gap-3 overflow-x-auto pb-2 pr-12 no-scrollbar mask-fade-right md:grid md:grid-cols-6 md:gap-3 md:overflow-visible md:pb-0 md:pr-0 md:![mask-image:none] md:![-webkit-mask-image:none] lg:grid-cols-8">
        {books.map((book) => (
          <Link
            key={book.id}
            href={`/book/${book.slug || book.id}`}
            className="group w-[120px] flex-shrink-0 md:w-full"
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
