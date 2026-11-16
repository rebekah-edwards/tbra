import Link from "next/link";
import Image from "next/image";
import { NoCover } from "@/components/no-cover";
import { getSimilarBooks } from "@/lib/queries/recommendations";

/**
 * Similar Books row on the book page.
 *
 * A SERVER component on purpose (2026-11-16). It used to fetch
 * /api/books/similar from the browser, and robots.txt disallows /api/, so
 * crawlers could never load it: book pages linked to zero other books. Render
 * it inside <Suspense fallback={<SimilarBooksSkeleton />}> — it streams into
 * the same HTML response without holding up the rest of the page.
 */
export function SimilarBooksSkeleton() {
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

export async function SimilarBooks({ bookId, userId }: { bookId: string; userId: string | null }) {
  let books: Awaited<ReturnType<typeof getSimilarBooks>> = [];
  try {
    books = await getSimilarBooks(bookId, userId);
  } catch {
    // Same as the old client behaviour on a failed fetch: no section.
    return null;
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
              {(book.contentWarnings?.length ?? 0) > 0 && (
                <span className="absolute top-1.5 left-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-yellow-500/90 text-black text-[11px] font-bold shadow-sm" title="Contains flagged content for your settings">
                  !
                </span>
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
