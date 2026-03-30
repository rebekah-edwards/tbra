"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { NoCover } from "@/components/no-cover";
import type { ShelfBook } from "@/lib/queries/shelves";

type SortKey = "position" | "title" | "author" | "userRating" | "overallRating" | "pubYear" | "pages" | "dateAdded";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "position", label: "Shelf Order" },
  { key: "dateAdded", label: "Date Added" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "userRating", label: "Your Rating" },
  { key: "overallRating", label: "Overall Rating" },
  { key: "pubYear", label: "Pub Year" },
  { key: "pages", label: "Pages" },
];

function sortBooks(books: ShelfBook[], sort: SortKey): ShelfBook[] {
  const sorted = [...books];
  switch (sort) {
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "author":
      sorted.sort((a, b) => (a.authors[0] ?? "").localeCompare(b.authors[0] ?? ""));
      break;
    case "userRating":
      sorted.sort((a, b) => (b.userRating ?? 0) - (a.userRating ?? 0));
      break;
    case "overallRating":
      sorted.sort((a, b) => (b.aggregateRating ?? 0) - (a.aggregateRating ?? 0));
      break;
    case "pubYear":
      sorted.sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0));
      break;
    case "pages":
      sorted.sort((a, b) => (a.pages ?? 9999) - (b.pages ?? 9999));
      break;
    case "dateAdded":
      sorted.sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
      break;
    case "position":
    default:
      sorted.sort((a, b) => a.position - b.position);
      break;
  }
  return sorted;
}

/** Chunk array into rows of N */
function chunkRows<T>(arr: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size));
  }
  return rows;
}

interface ShelfViewClientProps {
  books: ShelfBook[];
  accentColor: string;
  userAvatarUrl?: string | null;
  isOwner?: boolean;
  editHref?: string;
}

export function ShelfViewClient({ books: initialBooks, accentColor, userAvatarUrl, isOwner, editHref }: ShelfViewClientProps) {
  const [sort, setSort] = useState<SortKey>("position");
  const [genreFilter, setGenreFilter] = useState<string>("");
  const [ownershipFilter, setOwnershipFilter] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Collect available genres
  const availableGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of initialBooks) {
      for (const g of book.genres) {
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [initialBooks]);

  // Apply filters then sort
  const displayBooks = useMemo(() => {
    let filtered = initialBooks;
    if (genreFilter) {
      filtered = filtered.filter((b) => b.genres.includes(genreFilter));
    }
    if (ownershipFilter === "owned") {
      filtered = filtered.filter((b) => b.ownedFormats.length > 0);
    } else if (ownershipFilter === "unowned") {
      filtered = filtered.filter((b) => b.ownedFormats.length === 0);
    }
    return sortBooks(filtered, sort);
  }, [initialBooks, sort, genreFilter, ownershipFilter]);

  const hasFilters = !!genreFilter || !!ownershipFilter;
  const activeFilterCount = (genreFilter ? 1 : 0) + (ownershipFilter ? 1 : 0);

  // Chunk into bookshelf rows
  const mobileRows = chunkRows(displayBooks, 3);
  const desktopRows = chunkRows(displayBooks, 5);

  return (
    <div>
      {/* Sort bar + filter toggle */}
      {initialBooks.length > 1 && (
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>

            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
                hasFilters
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-border bg-surface-alt text-muted hover:text-foreground"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>

            {isOwner && editHref && (
              <Link
                href={editHref}
                className="ml-auto flex items-center gap-1 text-xs text-link hover:text-link/80 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
                Edit
              </Link>
            )}
          </div>

          {/* Collapsible filter panel */}
          {filtersOpen && (
            <div className="mt-2 rounded-lg border border-border bg-surface-alt/50 p-3 space-y-2.5">
              {/* Genre dropdown */}
              {availableGenres.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-muted uppercase tracking-wider w-12 shrink-0">Genre</label>
                  <select
                    value={genreFilter}
                    onChange={(e) => setGenreFilter(e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
                  >
                    <option value="">All Genres</option>
                    {availableGenres.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Ownership dropdown */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted uppercase tracking-wider w-12 shrink-0">Owned</label>
                <select
                  value={ownershipFilter}
                  onChange={(e) => setOwnershipFilter(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
                >
                  <option value="">All</option>
                  <option value="owned">Owned</option>
                  <option value="unowned">Unowned</option>
                </select>
              </div>

              {hasFilters && (
                <button
                  onClick={() => { setGenreFilter(""); setOwnershipFilter(""); }}
                  className="text-[10px] text-link hover:text-link/80"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bookshelf visual */}
      {displayBooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">
            {hasFilters ? "No books match your filters." : "This shelf is empty."}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: 3 per row */}
          <div
            className="rounded-xl border overflow-hidden lg:hidden"
            style={{
              background: `linear-gradient(to bottom, ${accentColor}06, ${accentColor}10)`,
              borderColor: `${accentColor}15`,
            }}
          >
            {mobileRows.map((row, ri) => (
              <div key={ri}>
                <div className="flex justify-start gap-4 px-4 pt-4 pb-2.5">
                  {row.map((book) => (
                    <BookOnShelf key={book.bookId} book={book} userAvatarUrl={userAvatarUrl} maxWidth="30%" />
                  ))}
                </div>
                <div
                  className="h-[5px] shadow-[inset_0_2px_3px_rgba(0,0,0,0.1)]"
                  style={{ background: `linear-gradient(to bottom, ${accentColor}30, ${accentColor}45)` }}
                />
                <div className="h-1.5" />
              </div>
            ))}
          </div>
          {/* Desktop: 5 per row */}
          <div
            className="rounded-xl border overflow-hidden hidden lg:block"
            style={{
              background: `linear-gradient(to bottom, ${accentColor}06, ${accentColor}10)`,
              borderColor: `${accentColor}15`,
            }}
          >
            {desktopRows.map((row, ri) => (
              <div key={ri}>
                <div className="flex justify-start gap-4 px-4 pt-4 pb-2.5">
                  {row.map((book) => (
                    <BookOnShelf key={book.bookId} book={book} userAvatarUrl={userAvatarUrl} maxWidth="18%" />
                  ))}
                </div>
                <div
                  className="h-[5px] shadow-[inset_0_2px_3px_rgba(0,0,0,0.1)]"
                  style={{ background: `linear-gradient(to bottom, ${accentColor}30, ${accentColor}45)` }}
                />
                <div className="h-1.5" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BookOnShelf({ book, userAvatarUrl, maxWidth }: { book: ShelfBook; userAvatarUrl?: string | null; maxWidth: string }) {
  return (
    <Link
      href={`/book/${book.slug || book.bookId}`}
      className="group flex-1"
      style={{ maxWidth }}
    >
      <div className="relative">
        {book.coverImageUrl ? (
          <Image
            src={book.coverImageUrl}
            alt={`Cover of ${book.title}`}
            width={100}
            height={150}
            className="w-full aspect-[2/3] rounded-sm object-cover shadow-[2px_2px_8px_rgba(0,0,0,0.3)] group-hover:scale-[1.03] transition-transform duration-200"
          />
        ) : (
          <NoCover title={book.title} className="w-full aspect-[2/3] rounded-sm shadow-[2px_2px_8px_rgba(0,0,0,0.3)]" size="md" />
        )}
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-r from-black/20 to-transparent rounded-l-sm" />
        {book.userRating != null && book.userRating > 0 && (
          <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-full bg-black/75 pl-0.5 pr-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
            {userAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userAvatarUrl} alt="" className="w-3.5 h-3.5 rounded-full object-cover flex-shrink-0" />
            ) : (
              <span className="w-3.5 h-3.5 rounded-full bg-accent/60 flex items-center justify-center text-[7px] text-black font-bold flex-shrink-0">★</span>
            )}
            {book.userRating % 1 === 0 ? book.userRating.toFixed(0) : book.userRating.toFixed(2)} ★
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-foreground font-medium line-clamp-2 leading-tight">
        {book.title}
      </p>
      <p className="text-[10px] text-muted truncate">
        {book.authors.join(", ")}
      </p>
    </Link>
  );
}
