import Image from "next/image";
import Link from "next/link";

interface SeriesBook {
  id: string;
  title: string;
  coverImageUrl: string | null;
  position: number | null;
}

interface BookSeriesProps {
  name: string;
  books: SeriesBook[];
  currentBookId: string;
}

export function BookSeries({ name, books, currentBookId }: BookSeriesProps) {
  if (books.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Books in the {name} Series</h2>
      <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
        {books.map((book) => {
          const isCurrent = book.id === currentBookId;
          return (
            <Link
              key={book.id}
              href={`/book/${book.id}`}
              className={`group flex-shrink-0 ${isCurrent ? "opacity-100" : "opacity-80 hover:opacity-100"} transition-opacity`}
            >
              <div className={`w-[120px] ${isCurrent ? "ring-2 ring-primary ring-offset-2 rounded-lg" : ""}`}>
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
              <p className="w-[120px] truncate text-xs text-muted group-hover:text-foreground transition-colors">
                {book.title}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
