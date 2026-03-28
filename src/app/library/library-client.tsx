"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { BookCard } from "@/components/book-card";
import type { UserBookWithDetails } from "@/lib/queries/reading-state";

type GroupKey = "activity" | "tbr" | "owned";
type SortKey = "recent" | "title" | "author" | "rating";

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "tbr", label: "TBR" },
  { key: "activity", label: "Activity" },
  { key: "owned", label: "Owned" },
];

const SUB_FILTERS: Record<GroupKey, { key: string; label: string }[]> = {
  activity: [
    { key: "currently_reading", label: "Current Read" },
    { key: "completed", label: "Finished" },
    { key: "paused", label: "Paused" },
    { key: "dnf", label: "DNF" },
  ],
  tbr: [
    { key: "all", label: "All" },
    { key: "owned", label: "Owned" },
    { key: "not_owned", label: "Not Owned" },
    { key: "fiction", label: "Fiction" },
    { key: "nonfiction", label: "Non-Fiction" },
  ],
  owned: [
    { key: "all", label: "All" },
    { key: "hardcover", label: "Hardcover" },
    { key: "paperback", label: "Paperback" },
    { key: "ebook", label: "eBook" },
    { key: "audiobook", label: "Audiobook" },
  ],
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently Updated" },
  { key: "title", label: "Title A-Z" },
  { key: "author", label: "Author A-Z" },
];

function sortBooks(books: UserBookWithDetails[], sort: SortKey): UserBookWithDetails[] {
  const sorted = [...books];
  switch (sort) {
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "author":
      sorted.sort((a, b) => (a.authors[0] ?? "").localeCompare(b.authors[0] ?? ""));
      break;
    case "rating":
      sorted.sort((a, b) => (b.userRating ?? 0) - (a.userRating ?? 0));
      break;
    case "recent":
    default:
      sorted.sort((a, b) => {
        const dateA = a.updatedAt ?? "";
        const dateB = b.updatedAt ?? "";
        return dateB.localeCompare(dateA);
      });
      break;
  }
  return sorted;
}

function filterBooks(books: UserBookWithDetails[], group: GroupKey, subFilter: string): UserBookWithDetails[] {
  switch (group) {
    case "activity":
      return books.filter((b) => b.state === subFilter);
    case "tbr": {
      const tbrBooks = books.filter((b) => b.state === "tbr");
      switch (subFilter) {
        case "owned":
          return tbrBooks.filter((b) => b.ownedFormats.length > 0);
        case "not_owned":
          return tbrBooks.filter((b) => b.ownedFormats.length === 0);
        case "fiction":
          return tbrBooks.filter((b) => b.isFiction === true);
        case "nonfiction":
          return tbrBooks.filter((b) => b.isFiction === false);
        default:
          return tbrBooks;
      }
    }
    case "owned": {
      const ownedBooks = books.filter((b) => b.ownedFormats.length > 0);
      if (subFilter === "all") return ownedBooks;
      return ownedBooks.filter((b) => b.ownedFormats.includes(subFilter));
    }
  }
}

/** Apply advanced filters (year, genre, rating, fiction/nonfiction, format) on top of base filtering */
function applyAdvancedFilters(
  books: UserBookWithDetails[],
  filters: {
    year?: string;
    genre?: string;
    minRating?: number;
    fictionFilter?: string;
    format?: string;
  }
): UserBookWithDetails[] {
  let result = books;

  if (filters.year && filters.year !== "all") {
    const yr = parseInt(filters.year, 10);
    if (!isNaN(yr)) {
      result = result.filter((b) => b.completionYear === yr);
    }
  }

  if (filters.genre) {
    const g = filters.genre.toLowerCase();
    result = result.filter((b) => b.genres.some((bg) => bg.toLowerCase() === g));
  }

  if (filters.minRating && filters.minRating > 0) {
    result = result.filter((b) => (b.userRating ?? 0) >= filters.minRating!);
  }

  if (filters.fictionFilter === "fiction") {
    result = result.filter((b) => b.isFiction === true);
  } else if (filters.fictionFilter === "nonfiction") {
    result = result.filter((b) => b.isFiction === false);
  }

  if (filters.format && filters.format !== "all") {
    result = result.filter((b) =>
      b.ownedFormats.includes(filters.format!) || b.activeFormats.includes(filters.format!)
    );
  }

  return result;
}

/* ─── Dropdown Component ─── */

function Dropdown({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { key: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  const activeLabel = options.find((o) => o.key === value)?.label ?? label;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs text-foreground whitespace-nowrap"
      >
        {activeLabel}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border border-border bg-surface shadow-lg py-1 min-w-[140px]">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => { onChange(opt.key); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                value === opt.key ? "text-accent font-medium" : "text-foreground hover:bg-surface-alt"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Star rating filter ─── */

function StarFilter({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(value === star ? 0 : star)}
          className={`text-sm transition-colors ${star <= value ? "text-accent" : "text-muted/40"}`}
          title={value === star ? "Clear rating filter" : `${star}+ stars`}
        >
          ★
        </button>
      ))}
      {value > 0 && (
        <span className="text-[10px] text-muted ml-1">{value}+</span>
      )}
    </div>
  );
}

/* ─── Main Component ─── */

export function LibraryClient({ books }: { books: UserBookWithDetails[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read state from URL params
  const activeGroup = (searchParams.get("tab") as GroupKey) || "tbr";
  const activeSubFilter = searchParams.get("filter") || SUB_FILTERS[activeGroup]?.[0]?.key || "all";
  const sort = (searchParams.get("sort") as SortKey) || "recent";
  const yearFilter = searchParams.get("year") || "";
  const genreFilter = searchParams.get("genre") || "";
  const minRating = parseInt(searchParams.get("rating") || "0", 10);
  const fictionFilter = searchParams.get("fiction") || "";
  const formatFilter = searchParams.get("format") || "";
  const [filtersOpen, setFiltersOpen] = useState(() => {
    // Auto-open if any advanced filters are active from URL
    return !!(yearFilter || genreFilter || minRating || fictionFilter || formatFilter);
  });

  // Validate group key
  const validGroup = GROUPS.some((g) => g.key === activeGroup) ? activeGroup : "tbr";

  // Update URL params helper
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val === null || val === "" || val === "0") {
          params.delete(key);
        } else {
          params.set(key, val);
        }
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  // Compute summary stats
  const ownedCount = useMemo(() => books.filter((b) => b.ownedFormats.length > 0).length, [books]);
  const readCount = useMemo(() => books.filter((b) => b.state === "completed").length, [books]);
  const tbrCount = useMemo(() => books.filter((b) => b.state === "tbr").length, [books]);

  const subFilters = SUB_FILTERS[validGroup];

  // Base filter (tab + sub-filter, before advanced filters)
  const baseFiltered = filterBooks(books, validGroup, activeSubFilter);

  // Get available genres from the current tab's books (not all books)
  const availableGenres = useMemo(() => {
    const genreCounts = new Map<string, number>();
    for (const book of baseFiltered) {
      for (const g of book.genres) {
        genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
      }
    }
    return Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [baseFiltered]);

  // Get available completion years from the current tab's books
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const book of baseFiltered) {
      if (book.completionYear) years.add(book.completionYear);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [baseFiltered]);
  const showAdvanced = validGroup === "activity" || validGroup === "tbr";
  const filteredBooks = showAdvanced
    ? sortBooks(
        applyAdvancedFilters(baseFiltered, {
          year: yearFilter,
          genre: genreFilter,
          minRating,
          fictionFilter,
          format: formatFilter,
        }),
        sort
      )
    : sortBooks(baseFiltered, sort);

  // Count for each sub-filter badge
  const subFilterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sf of subFilters) {
      counts[sf.key] = filterBooks(books, validGroup, sf.key).length;
    }
    return counts;
  }, [books, validGroup, subFilters]);

  // Active advanced filter count
  const advancedFilterCount = [yearFilter, genreFilter, minRating > 0 ? "y" : "", fictionFilter, formatFilter].filter(Boolean).length;

  function handleGroupChange(group: GroupKey) {
    updateParams({
      tab: group === "tbr" ? null : group,
      filter: null,
      sort: null,
      year: null,
      genre: null,
      rating: null,
      fiction: null,
      format: null,
    });
  }

  function handleSubFilterChange(sf: string) {
    updateParams({ filter: sf === SUB_FILTERS[validGroup][0].key ? null : sf, sort: null });
  }

  function handleSortChange(s: SortKey) {
    updateParams({ sort: s === "recent" ? null : s });
  }

  function clearAdvancedFilters() {
    updateParams({ year: null, genre: null, rating: null, fiction: null, format: null });
  }

  const showRating = validGroup === "activity" && activeSubFilter === "completed";

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          Bookshelf
        </h1>
        <span className="text-xs text-muted">
          {ownedCount} owned · {readCount} read · {tbrCount} tbr
        </span>
      </div>

      {/* My Shelves link */}
      <Link
        href="/library/shelves"
        className="flex items-center justify-between w-full rounded-xl border border-border bg-surface/50 px-4 py-3 mb-4 group transition-colors hover:border-accent/30"
      >
        <div className="flex items-center gap-2.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent shrink-0">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          </svg>
          <span className="text-sm font-medium text-foreground">My Shelves</span>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted/40 group-hover:text-accent transition-colors">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </Link>

      {/* Top-tier segments */}
      <div className="flex gap-1 rounded-xl bg-surface-alt p-1 mb-4">
        {GROUPS.map((group) => (
          <button
            key={group.key}
            onClick={() => handleGroupChange(group.key)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              validGroup === group.key
                ? "bg-accent text-black shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/* Sub-filter pills */}
      <div className="relative mb-4">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 pr-12 no-scrollbar mask-fade-right">
          {subFilters.map((sf) => {
            const count = subFilterCounts[sf.key];
            const isActive = activeSubFilter === sf.key;
            return (
              <button
                key={sf.key}
                onClick={() => handleSubFilterChange(sf.key)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-neon-blue/20 text-neon-blue border border-neon-blue/30"
                    : "bg-surface-alt text-muted hover:text-foreground hover:bg-surface-alt/80 border border-transparent"
                }`}
              >
                {sf.label}
                <span className={`text-[10px] ${isActive ? "text-neon-blue/70" : "text-muted/60"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Advanced Filters — collapsible, for Activity and TBR tabs */}
      {showAdvanced && (
        <div className="mb-4">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors mb-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            </svg>
            Filters
            {advancedFilterCount > 0 && (
              <span className="bg-accent/20 text-accent text-[10px] font-medium rounded-full px-1.5 py-0.5">
                {advancedFilterCount}
              </span>
            )}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {filtersOpen && (
            <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
              {/* Row 1: Year + Sort + Rating */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Year filter */}
                {availableYears.length > 0 && (
                  <Dropdown
                    value={yearFilter || "all"}
                    options={[
                      { key: "all", label: "All Years" },
                      ...availableYears.map((y) => ({ key: String(y), label: String(y) })),
                    ]}
                    onChange={(v) => updateParams({ year: v === "all" ? null : v })}
                    label="Year"
                  />
                )}

                {/* Fiction/Nonfiction */}
                <Dropdown
                  value={fictionFilter || "all"}
                  options={[
                    { key: "all", label: "All Types" },
                    { key: "fiction", label: "Fiction" },
                    { key: "nonfiction", label: "Non-Fiction" },
                  ]}
                  onChange={(v) => updateParams({ fiction: v === "all" ? null : v })}
                  label="Type"
                />

                {/* Format */}
                <Dropdown
                  value={formatFilter || "all"}
                  options={[
                    { key: "all", label: "All Formats" },
                    { key: "hardcover", label: "Hardcover" },
                    { key: "paperback", label: "Paperback" },
                    { key: "ebook", label: "eBook" },
                    { key: "audiobook", label: "Audiobook" },
                  ]}
                  onChange={(v) => updateParams({ format: v === "all" ? null : v })}
                  label="Format"
                />

                {/* Sort */}
                <Dropdown
                  value={sort}
                  options={[
                    ...SORT_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
                    ...(showRating ? [{ key: "rating", label: "Highest Rated" }] : []),
                  ]}
                  onChange={(v) => handleSortChange(v as SortKey)}
                  label="Sort"
                />
              </div>

              {/* Row 2: Rating filter */}
              {(validGroup === "activity" && (activeSubFilter === "completed" || activeSubFilter === "dnf")) && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">Min rating:</span>
                  <StarFilter
                    value={minRating}
                    onChange={(v) => updateParams({ rating: v > 0 ? String(v) : null })}
                  />
                </div>
              )}

              {/* Row 3: Genre pills */}
              {availableGenres.length > 0 && (
                <div>
                  <span className="text-xs text-muted mb-1.5 block">Genre</span>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 pr-8 no-scrollbar mask-fade-right">
                    <button
                      onClick={() => updateParams({ genre: null })}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium whitespace-nowrap transition-all ${
                        !genreFilter
                          ? "bg-neon-blue/20 text-neon-blue border border-neon-blue/30"
                          : "bg-surface-alt text-muted hover:text-foreground border border-transparent"
                      }`}
                    >
                      All
                    </button>
                    {availableGenres.slice(0, 20).map((g) => (
                      <button
                        key={g.name}
                        onClick={() => updateParams({ genre: genreFilter === g.name ? null : g.name })}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium whitespace-nowrap transition-all ${
                          genreFilter === g.name
                            ? "bg-neon-blue/20 text-neon-blue border border-neon-blue/30"
                            : "bg-surface-alt text-muted hover:text-foreground border border-transparent"
                        }`}
                      >
                        {g.name}
                        <span className="text-[9px] ml-1 opacity-60">{g.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Clear all */}
              {advancedFilterCount > 0 && (
                <button
                  onClick={clearAdvancedFilters}
                  className="text-[11px] text-destructive hover:text-destructive/80 transition-colors"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sort Controls — only show if advanced filters panel is not open (sort is inside it) */}
      {!showAdvanced && filteredBooks.length > 1 && (
        <div className="flex justify-end mb-4">
          <Dropdown
            value={sort}
            options={SORT_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
            onChange={(v) => handleSortChange(v as SortKey)}
            label="Sort"
          />
        </div>
      )}

      {/* Book Grid */}
      {filteredBooks.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {filteredBooks.map((book) => (
            <BookCard key={book.id} {...book} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted mb-2">
            {advancedFilterCount > 0 ? "No books match your filters." : "Nothing here yet."}
          </p>
          {advancedFilterCount > 0 ? (
            <button
              onClick={clearAdvancedFilters}
              className="text-sm text-link hover:text-link/80"
            >
              Clear filters
            </button>
          ) : (
            <Link href="/search" className="text-sm text-link hover:text-link/80">
              Find books to add
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
