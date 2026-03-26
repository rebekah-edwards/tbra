import Link from "next/link";
import Image from "next/image";
import type { FavoriteBook } from "@/lib/queries/favorites";
import { NoCover } from "@/components/no-cover";

interface FavoritesShelfProps {
  favorites: FavoriteBook[];
}

/** A single book or a group of adjacent same-series books */
type ShelfItem =
  | { type: "single"; book: FavoriteBook }
  | { type: "stack"; books: FavoriteBook[]; seriesId: string };

/**
 * Group favorites by series: all books from the same series stack together,
 * positioned where the first book from that series appears in the list.
 * Standalone books (no series) remain individual.
 */
function groupIntoShelfItems(favorites: FavoriteBook[]): ShelfItem[] {
  const items: ShelfItem[] = [];
  const seriesSeen = new Set<string>();

  // First pass: collect all series groups keyed by seriesId
  const seriesGroups = new Map<string, FavoriteBook[]>();
  for (const book of favorites) {
    if (book.seriesId) {
      const group = seriesGroups.get(book.seriesId) ?? [];
      group.push(book);
      seriesGroups.set(book.seriesId, group);
    }
  }

  // Second pass: build shelf items in order, inserting each series stack
  // at the position of its first book
  for (const book of favorites) {
    if (!book.seriesId) {
      items.push({ type: "single", book });
      continue;
    }

    if (seriesSeen.has(book.seriesId)) continue; // already placed this series
    seriesSeen.add(book.seriesId);

    const group = seriesGroups.get(book.seriesId)!;
    if (group.length === 1) {
      items.push({ type: "single", book: group[0] });
    } else {
      items.push({ type: "stack", books: group, seriesId: book.seriesId });
    }
  }

  return items;
}

function BookCover({ book }: { book: FavoriteBook }) {
  return (
    <div className="relative">
      {book.coverImageUrl ? (
        <Image
          src={book.coverImageUrl}
          alt={`Cover of ${book.title}`}
          width={72}
          height={108}
          className="h-[108px] w-[72px] rounded-sm object-cover shadow-[2px_2px_8px_rgba(0,0,0,0.3)]"
        />
      ) : (
        <NoCover
          title={book.title}
          className="h-[108px] w-[72px] rounded-sm shadow-[2px_2px_8px_rgba(0,0,0,0.3)]"
          size="md"
        />
      )}
      {/* Book spine shadow effect */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-r from-black/20 to-transparent rounded-l-sm" />
    </div>
  );
}

/** px offset between each stacked book */
const STACK_OFFSET_X = 8;
const STACK_OFFSET_Y = 5;
/** Extra space above the stack for the badge */
const BADGE_INSET = 8;

function SeriesStack({ books }: { books: FavoriteBook[] }) {
  // Sort by series position so the lowest-numbered book is on top
  const sorted = [...books].sort(
    (a, b) => (a.seriesPosition ?? 999) - (b.seriesPosition ?? 999)
  );
  const topBook = sorted[0];
  const stackCount = sorted.length;
  const totalOffsetX = (stackCount - 1) * STACK_OFFSET_X;
  const totalOffsetY = (stackCount - 1) * STACK_OFFSET_Y;

  return (
    <Link
      href={`/book/${topBook.slug || topBook.id}`}
      className="flex-shrink-0 group relative"
    >
      {/* Container sized to fit all stacked layers + badge overflow */}
      <div
        className="relative"
        style={{
          width: 72 + totalOffsetX,
          height: 108 + totalOffsetY + BADGE_INSET,
          marginTop: BADGE_INSET,
        }}
      >
        {sorted.map((book, i) => {
          const isTop = i === 0;
          // Back books offset up-left, front book sits at bottom-right
          const offsetX = (stackCount - 1 - i) * STACK_OFFSET_X;
          const offsetY = (stackCount - 1 - i) * STACK_OFFSET_Y + BADGE_INSET;
          const zIndex = stackCount - i;

          return (
            <div
              key={book.id}
              className="absolute"
              style={{
                left: offsetX,
                top: offsetY,
                zIndex,
                filter: isTop ? undefined : "brightness(0.8)",
              }}
            >
              <BookCover book={book} />
            </div>
          );
        })}

        {/* Stack count badge — positioned relative to the top book */}
        {stackCount > 1 && (
          <div
            className="absolute z-20 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-background shadow-md"
            style={{
              top: BADGE_INSET - 6,
              right: -4,
            }}
          >
            {stackCount}
          </div>
        )}
      </div>

      {/* Hover tooltip showing series info */}
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
        <span className="text-[9px] text-muted bg-surface/90 px-1.5 py-0.5 rounded shadow-sm">
          {stackCount} in series
        </span>
      </div>
    </Link>
  );
}

export function FavoritesShelf({ favorites }: FavoritesShelfProps) {
  const shelfItems = groupIntoShelfItems(favorites);

  return (
    <section>
      <h2
        className="section-heading text-sm mb-3"
      >
        Top-Shelf Reads
      </h2>
      {favorites.length > 0 ? (
        <div className="relative">
          {/* Bookshelf container */}
          <div className="relative rounded-xl bg-gradient-to-b from-amber-900/10 to-amber-800/20 dark:from-amber-900/20 dark:to-amber-800/30 border border-amber-800/20 dark:border-amber-700/20 px-4 pt-4 pb-2">
            {/* Books row */}
            <div className="flex gap-2.5 items-center overflow-x-auto pb-3 pt-2 -mx-1 px-1 pr-10 no-scrollbar mask-fade-right">
              {shelfItems.map((item) => {
                if (item.type === "single") {
                  return (
                    <Link
                      key={item.book.id}
                      href={`/book/${item.book.slug || item.book.id}`}
                      className="flex-shrink-0 group relative"
                    >
                      <BookCover book={item.book} />
                    </Link>
                  );
                }

                return (
                  <SeriesStack
                    key={`stack-${item.seriesId}`}
                    books={item.books}
                  />
                );
              })}
            </div>
            {/* Shelf edge */}
            <div className="h-[6px] -mx-4 rounded-b-xl bg-gradient-to-b from-amber-800/30 to-amber-900/40 dark:from-amber-700/30 dark:to-amber-800/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]" />
          </div>
          {/* Shelf shadow */}
          <div className="h-2 mx-2 bg-gradient-to-b from-black/10 to-transparent rounded-b-lg" />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted">Pin your all-time favorites here</p>
          <p className="mt-1 text-xs text-muted/60">
            Tap the heart on any book page to add it
          </p>
        </div>
      )}
    </section>
  );
}
