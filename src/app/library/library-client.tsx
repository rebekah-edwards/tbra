"use client";

import { memo, useState, useMemo, useRef, useEffect, useCallback, useDeferredValue } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { BookCard } from "@/components/book-card";
import type { UserBookWithDetails } from "@/lib/queries/reading-state";
import { librarySearchText, librarySearchTokens, matchesLibrarySearch } from "@/lib/library-search";

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
    { key: "flagged", label: "⚠ Flagged" },
  ],
  owned: [
    { key: "all", label: "All" },
    { key: "hardcover", label: "Hardcover" },
    { key: "paperback", label: "Paperback" },
    { key: "ebook", label: "eBook" },
    { key: "audiobook", label: "Audiobook" },
  ],
};

// Where a search hit can live. When the current view has no matches but the
// library does, the empty state offers these as one-tap jumps.
const SEARCH_VIEWS: { group: GroupKey; filter: string; label: string }[] = [
  { group: "tbr", filter: "all", label: "TBR" },
  { group: "activity", filter: "currently_reading", label: "Current Read" },
  { group: "activity", filter: "completed", label: "Finished" },
  { group: "activity", filter: "paused", label: "Paused" },
  { group: "activity", filter: "dnf", label: "DNF" },
  { group: "owned", filter: "all", label: "Owned" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently Updated" },
  { key: "title", label: "Title A-Z" },
  { key: "author", label: "Author A-Z" },
];

// Library convention: ignore a leading article when sorting by title, so
// "A Court of Thorns and Roses" files under C, not A.
const LEADING_ARTICLE = /^(?:a|an|the)\s+/i;
function titleSortKey(title: string): string {
  return title.replace(LEADING_ARTICLE, "").trim();
}

// Sort people by surname ("A. Rae Dunlap" -> "Dunlap, A. Rae"), the way a
// library shelf does. Books with no author sort last rather than first.
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|phd|md)\.?$/i;
// Surname particles travel with the surname: "Ursula K. Le Guin" -> "Le Guin, Ursula K."
const NAME_PARTICLE = /^(le|la|de|del|della|di|da|dos|du|van|von|der|den|ter|ten|bin|al|st|mac|mc)\.?$/i;
function authorSortKey(name: string | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "￿"; // no author -> end of list
  if (n.includes(",")) return n; // already "Last, First"
  const parts = n.split(/\s+/).filter(Boolean);
  let end = parts.length - 1;
  while (end > 0 && NAME_SUFFIX.test(parts[end])) end--; // skip Jr./III when finding the surname
  let start = end;
  while (start > 0 && NAME_PARTICLE.test(parts[start - 1])) start--; // absorb "Le", "van", ...
  const surname = parts.slice(start, end + 1).join(" ") || n;
  const rest = [...parts.slice(0, start), ...parts.slice(end + 1)].join(" ");
  return rest ? `${surname}, ${rest}` : surname;
}

function sortBooks(books: UserBookWithDetails[], sort: SortKey): UserBookWithDetails[] {
  const sorted = [...books];
  switch (sort) {
    case "title":
      sorted.sort((a, b) =>
        titleSortKey(a.title).localeCompare(titleSortKey(b.title), undefined, { sensitivity: "base" })
      );
      break;
    case "author":
      sorted.sort((a, b) =>
        authorSortKey(a.authors[0]).localeCompare(authorSortKey(b.authors[0]), undefined, { sensitivity: "base" })
      );
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

function filterBooks(books: UserBookWithDetails[], group: GroupKey, subFilter: string, conflictIds?: Set<string>): UserBookWithDetails[] {
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
        case "flagged":
          return tbrBooks.filter((b) => conflictIds?.has(b.id));
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

/* ─── Book grid ─── */

// Memoized so typing in the search field stays instant: each keystroke
// re-renders LibraryClient, but the (up to four-figure) grid only re-renders
// when the deferred, filtered list actually changes.
const BookGrid = memo(function BookGrid({
  books,
  conflictIds,
}: {
  books: UserBookWithDetails[];
  conflictIds: Set<string>;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {books.map((book, i) => (
        <BookCard key={book.id} {...book} hasContentConflict={conflictIds.has(book.id)} staggerIndex={i} />
      ))}
    </div>
  );
});

/* ─── Main Component ─── */

export function LibraryClient({ books, contentPrefs = {} }: { books: UserBookWithDetails[]; contentPrefs?: Record<string, number> }) {
  const initialParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Seed from the URL once, then own the state locally. Calling
  // `router.replace` repeatedly was leaving the tab/filter UI wedged on
  // desktop — clicks stopped updating the URL on a warm page. Switching
  // to local state + native `history.replaceState` for the URL sync
  // keeps the visible UI responsive regardless of what the Next.js
  // router is doing under the hood.
  const [params, setParams] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    initialParams.forEach((v, k) => { if (v) out[k] = v; });
    return out;
  });

  const activeGroup = (params.tab as GroupKey) || "tbr";
  const activeSubFilter = params.filter || SUB_FILTERS[activeGroup]?.[0]?.key || "all";
  const sort = (params.sort as SortKey) || "recent";
  const yearFilter = params.year || "";
  const genreFilter = params.genre || "";
  const minRating = parseInt(params.rating || "0", 10);
  const fictionFilter = params.fiction || "";
  const formatFilter = params.format || "";
  const [filtersOpen, setFiltersOpen] = useState(() => {
    return !!(yearFilter || genreFilter || minRating || fictionFilter || formatFilter);
  });

  // In-library search. `query` is what the input shows (updates on every
  // keystroke); the filtering below runs off the deferred copy so a big
  // grid never blocks typing. Purely in-memory over `books` — no requests.
  const [query, setQuery] = useState(() => initialParams.get("q") ?? "");
  const deferredQuery = useDeferredValue(query);
  // Design refresh 2026-11: search lives behind a toolbar button and expands
  // into the field. Open on arrival when the URL already carries a query.
  const [searchOpen, setSearchOpen] = useState(() => (initialParams.get("q") ?? "") !== "");
  const searchPending = query !== deferredQuery;

  // Mirror the query into the URL params as `q`, like tab/filter/sort, so
  // coming back from a book page (or a reload) restores the search. Debounced:
  // Safari throws once replaceState is called ~100 times in a short window,
  // and a per-keystroke write would also re-render the whole page each time.
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(() => {
      setParams((prev) => {
        if ((prev.q ?? "") === q) return prev;
        const next = { ...prev };
        if (q) next.q = q;
        else delete next.q;
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Keep the URL in sync as state changes so shared/bookmarked links work,
  // but drive the UI off local state to avoid a router-induced hang.
  useEffect(() => {
    const qs = new URLSearchParams(params).toString();
    const url = `${pathname}${qs ? `?${qs}` : ""}`;
    if (typeof window !== "undefined" && window.location.pathname + window.location.search !== url) {
      try {
        window.history.replaceState(window.history.state, "", url);
      } catch {
        // Browser rate-limited history writes — the UI state is still correct.
      }
    }
  }, [params, pathname]);
  // Keep router / pathname imports live for any other routing use below.
  void router;

  const validGroup = GROUPS.some((g) => g.key === activeGroup) ? activeGroup : "tbr";

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setParams((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(updates)) {
          if (val === null || val === "" || val === "0") {
            delete next[key];
          } else {
            next[key] = val;
          }
        }
        return next;
      });
    },
    []
  );

  // Compute summary stats
  const ownedCount = useMemo(() => books.filter((b) => b.ownedFormats.length > 0).length, [books]);
  const tbrCount = useMemo(() => books.filter((b) => b.state === "tbr").length, [books]);

  // Compute which books have content conflicts with user preferences
  const contentConflictIds = useMemo(() => {
    const hasPrefs = Object.keys(contentPrefs).length > 0;
    if (!hasPrefs) return new Set<string>();
    const ids = new Set<string>();
    for (const book of books) {
      for (const r of book.contentRatings) {
        const userMax = contentPrefs[r.categoryId];
        if (userMax !== undefined && userMax < 4 && r.intensity > userMax) {
          ids.add(book.id);
          break;
        }
      }
    }
    return ids;
  }, [books, contentPrefs]);

  const subFilters = SUB_FILTERS[validGroup];

  // Search runs FIRST, over the whole library; the tab, sub-filter and
  // advanced filters then narrow the matches as usual. That way the
  // sub-filter counts, genre pills and year list all describe the matches.
  // Folded title+author+series text is built once per book list, so a
  // keystroke costs one substring test per book.
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const book of books) index.set(book.id, librarySearchText(book));
    return index;
  }, [books]);
  const searchTokens = useMemo(() => librarySearchTokens(deferredQuery), [deferredQuery]);
  const searchActive = searchTokens.length > 0;
  const searchedBooks = useMemo(
    () =>
      searchTokens.length === 0
        ? books
        : books.filter((b) => matchesLibrarySearch(searchIndex.get(b.id) ?? "", searchTokens)),
    [books, searchIndex, searchTokens]
  );

  // Base filter (tab + sub-filter, before advanced filters)
  const baseFiltered = useMemo(
    () => filterBooks(searchedBooks, validGroup, activeSubFilter, contentConflictIds),
    [searchedBooks, validGroup, activeSubFilter, contentConflictIds]
  );

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
  const filteredBooks = useMemo(
    () =>
      showAdvanced
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
        : sortBooks(baseFiltered, sort),
    [baseFiltered, showAdvanced, yearFilter, genreFilter, minRating, fictionFilter, formatFilter, sort]
  );

  // Count for each sub-filter badge (of the search matches, when searching)
  const subFilterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sf of subFilters) {
      counts[sf.key] = filterBooks(searchedBooks, validGroup, sf.key, contentConflictIds).length;
    }
    return counts;
  }, [searchedBooks, validGroup, subFilters, contentConflictIds]);

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

  function clearSearch() {
    setQuery("");
  }

  // Jump to another tab/sub-filter, keeping the search (`q` is untouched).
  function goToView(group: GroupKey, filter: string) {
    updateParams({
      tab: group === "tbr" ? null : group,
      filter: filter === SUB_FILTERS[group][0].key ? null : filter,
      sort: null,
      year: null,
      genre: null,
      rating: null,
      fiction: null,
      format: null,
    });
  }

  // Only needed for the search empty state: did the search hit anywhere the
  // reader can actually see? (`books` also carries rows no view shows — e.g.
  // removed books kept with a null state — so `searchedBooks.length` alone
  // would overstate it.)
  const searchCameUpEmpty = searchActive && filteredBooks.length === 0;
  const matchesElsewhere = searchCameUpEmpty
    ? SEARCH_VIEWS.filter((v) => !(v.group === validGroup && v.filter === activeSubFilter))
        .map((v) => ({ ...v, count: filterBooks(searchedBooks, v.group, v.filter, contentConflictIds).length }))
        .filter((v) => v.count > 0)
    : [];
  // Matches exist in this very view but the advanced filters hide them.
  const matchesHiddenByFilters = searchCameUpEmpty && baseFiltered.length > 0;
  const shownQuery = deferredQuery.trim();

  const showRating = validGroup === "activity" && activeSubFilter === "completed";

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Design refresh 2026-11 (mirrors native-ios LibraryView headerV2).
          Five stacked rows became three: title + Shelves pill, the tab
          switch (now carrying the counts), and ONE toolbar holding search,
          filters and the sub-filter chips. */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          My Library
        </h1>
        <Link
          href="/library/shelves"
          className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-surface/70 backdrop-blur-md px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0" aria-hidden="true">
            <path d="M4 4h2v16H4z" />
            <path d="M8 4h2v16H8z" />
            <path d="M13 4l2 16" />
            <path d="M18 4l2 16" />
          </svg>
          Shelves
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
      </div>

      {/* Tab switch — counts moved in from the old header line */}
      <div className="flex gap-1 rounded-full border border-foreground/10 bg-surface/70 backdrop-blur-md p-1 mb-3">
        {GROUPS.map((group) => {
          const active = validGroup === group.key;
          const count = group.key === "tbr" ? tbrCount : group.key === "owned" ? ownedCount : null;
          return (
            <button
              key={group.key}
              onClick={() => handleGroupChange(group.key)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm transition-all ${
                active ? "bg-accent text-black font-bold shadow-sm" : "text-muted font-medium hover:text-foreground"
              }`}
            >
              {group.label}
              {count != null && <span className="text-xs font-semibold opacity-60 tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Toolbar: search · filters · sub-filter chips. Search expands in place. */}
      <div className="mb-4">
        {searchOpen || query ? (
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {/* text-base (16px) on purpose: anything smaller makes iOS Safari
                  zoom the page when the field is focused. */}
              <input
                type="text"
                inputMode="search"
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur(); // dismiss the phone keyboard
                  if (e.key === "Escape") {
                    clearSearch();
                    setSearchOpen(false);
                  }
                }}
                placeholder="Title, author or series"
                aria-label="Search your library by title, author, or series"
                maxLength={100}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                className="h-10 w-full rounded-full border border-foreground/10 bg-surface/70 backdrop-blur-md pl-10 pr-11 text-base text-foreground placeholder:text-muted/60 focus:outline-none focus:border-accent"
              />
              {query && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                clearSearch();
                setSearchOpen(false);
              }}
              className="text-sm font-medium text-neon-blue hover:text-neon-blue/80"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search your library"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-surface/70 backdrop-blur-md text-foreground shadow-sm transition-colors hover:border-accent/40"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            {showAdvanced && (
              <button
                type="button"
                onClick={() => setFiltersOpen(!filtersOpen)}
                aria-label="Filters"
                aria-expanded={filtersOpen}
                className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border bg-surface/70 backdrop-blur-md text-foreground shadow-sm transition-colors ${
                  filtersOpen ? "border-accent" : "border-foreground/10 hover:border-accent/40"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                  <line x1="10" y1="17" x2="14" y2="17" />
                </svg>
                {advancedFilterCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-black">
                    {advancedFilterCount}
                  </span>
                )}
              </button>
            )}
            <div className="relative min-w-0 flex-1">
              <div className="flex gap-2 overflow-x-auto py-0.5 pr-10 no-scrollbar mask-fade-right">
                {subFilters.map((sf) => {
                  const count = subFilterCounts[sf.key];
                  const isActive = activeSubFilter === sf.key;
                  return (
                    <button
                      key={sf.key}
                      onClick={() => handleSubFilterChange(sf.key)}
                      className={`flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13px] whitespace-nowrap transition-all ${
                        isActive
                          ? "bg-foreground/10 text-foreground font-semibold border-foreground/35"
                          : "text-muted font-medium border-border hover:text-foreground"
                      }`}
                    >
                      {sf.label}
                      <span className="text-[11px] opacity-60 tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Advanced Filters — collapsible, for Activity and TBR tabs */}
      {showAdvanced && (
        <div className="mb-4">
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
        <div className={`transition-opacity ${searchPending ? "opacity-60" : ""}`} aria-busy={searchPending}>
          <BookGrid books={filteredBooks} conflictIds={contentConflictIds} />
        </div>
      ) : searchActive ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center" role="status">
          <p className="text-sm text-muted break-words">
            {matchesElsewhere.length > 0 || matchesHiddenByFilters
              ? "Nothing in this view matches "
              : "No books in your library match "}
            <span className="text-foreground">&ldquo;{shownQuery}&rdquo;</span>.
          </p>
          {matchesElsewhere.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted mb-2">Found elsewhere in your library:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {matchesElsewhere.map((v) => (
                  <button
                    key={`${v.group}:${v.filter}`}
                    onClick={() => goToView(v.group, v.filter)}
                    className="flex items-center gap-1.5 rounded-full border border-neon-blue/30 bg-neon-blue/20 px-3.5 py-1.5 text-xs font-medium text-neon-blue whitespace-nowrap"
                  >
                    {v.label}
                    <span className="text-[10px] text-muted">{v.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2">
            {matchesHiddenByFilters && (
              <button
                onClick={clearAdvancedFilters}
                className="px-3 py-2 text-sm text-neon-blue hover:text-neon-blue/80"
              >
                Clear filters
              </button>
            )}
            <button
              onClick={clearSearch}
              className="px-3 py-2 text-sm text-neon-blue hover:text-neon-blue/80"
            >
              Clear search
            </button>
          </div>
        </div>
      ) : (
        // Design refresh 2026-11 (mirrors iOS LibraryView's empty state): a
        // headline, a lime action and, for a brand-new library, the import link.
        <div className="rounded-[20px] border border-border bg-surface/60 px-5 py-11 text-center">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-muted" aria-hidden="true">
            <path d="m16 6 4 14" />
            <path d="M12 6v14" />
            <path d="M8 8v12" />
            <path d="M4 4v16" />
          </svg>
          <p className="mt-3 font-heading text-[19px] font-bold text-foreground">
            {advancedFilterCount > 0
              ? "No books match your filters"
              : books.length === 0
                ? "Your library starts here"
                : "Nothing in this view yet"}
          </p>
          {advancedFilterCount > 0 ? (
            <button
              onClick={clearAdvancedFilters}
              className="mt-3 text-sm font-medium text-neon-blue hover:text-neon-blue/80"
            >
              Clear filters
            </button>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-muted">
                {books.length === 0
                  ? "Add the books you own, want to read, or have finished."
                  : "Try another tab or filter, or add more books."}
              </p>
              <Link
                href="/search"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-[15px] font-bold text-black hover:brightness-110 transition-all"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Find books to add
              </Link>
              {books.length === 0 && (
                <Link href="/import" className="mt-3 block text-sm font-medium text-neon-blue hover:text-neon-blue/80">
                  Import from Goodreads or StoryGraph
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
