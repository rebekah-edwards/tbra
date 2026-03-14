import Image from "next/image";
import Link from "next/link";
import { StarRow } from "@/components/review/rounded-star";

interface SeriesBook {
  id: string;
  title: string;
  coverImageUrl: string | null;
  position: number | null;
  userRating: number | null;
}

interface BookSeriesProps {
  seriesId: string;
  name: string;
  books: SeriesBook[];
  currentBookId: string;
}

export function BookSeries({ seriesId, name, books, currentBookId }: BookSeriesProps) {
  if (books.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold uppercase tracking-wide text-neon-blue">More in this series</h2>
      <div className="mt-4 flex gap-4 overflow-x-auto px-1 py-1 pb-2">
        {books.map((book) => {
          const isCurrent = book.id === currentBookId;
          return (
            <Link
              key={book.id}
              href={`/book/${book.id}`}
              className={`group flex-shrink-0 ${isCurrent ? "opacity-100" : "opacity-80 hover:opacity-100"} transition-opacity`}
            >
              <div className={`w-[120px] ${isCurrent ? "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-lg" : ""}`}>
                {book.coverImageUrl ? (
                  <Image
                    src={book.coverImageUrl}
                    alt={`Cover of ${book.title}`}
                    width={120}
                    height={180}
                    className="aspect-[2/3] w-[120px] rounded-lg object-cover shadow-sm"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-[120px] items-center justify-center rounded-lg bg-surface-alt text-xs text-muted shadow-sm">
                    No cover
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs font-medium text-muted">
                Book {book.position ?? "?"}
              </p>
              <p className="w-[120px] text-xs text-muted group-hover:text-foreground transition-colors leading-tight line-clamp-2">
                {book.title}
              </p>
              {book.userRating != null && book.userRating > 0 && (
                <div className="mt-1 flex items-center gap-1">
                  <StarRow rating={book.userRating} size={12} />
                </div>
              )}
            </Link>
          );
        })}
      </div>

      <Link
        href={`/search?series=${encodeURIComponent(seriesId)}`}
        className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-neon-purple text-white py-3 px-5 text-sm font-semibold shadow-[0_0_16px_rgba(192,132,252,0.3)] hover:brightness-110 transition-all"
      >
        View all books in this series
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>
    </section>
  );
}
