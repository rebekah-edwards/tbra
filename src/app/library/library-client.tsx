"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
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

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently Updated" },
  { key: "title", label: "Title A-Z" },
  { key: "author", label: "Author A-Z" },
];

function SortDropdown({
  sort,
  onSortChange,
  showRating,
}: {
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  showRating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  const options = showRating
    ? [...SORT_OPTIONS, { key: "rating" as SortKey, label: "Highest Rated" }]
    : SORT_OPTIONS;
  const activeLabel = options.find((o) => o.key === sort)?.label ?? "Sort";

  return (
    <div className="flex justify-end mb-4" ref={ref}>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs text-foreground"
        >
          {activeLabel}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-30 rounded-lg border border-border bg-surface shadow-lg py-1 min-w-[160px]">
            {options.map((opt) => (
              <button
                key={opt.key}
                onClick={() => { onSortChange(opt.key); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                  sort === opt.key ? "text-accent font-medium" : "text-foreground hover:bg-surface-alt"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function LibraryClient({ books }: { books: UserBookWithDetails[] }) {
  const [activeGroup, setActiveGroup] = useState<GroupKey>("tbr");
  const [activeSubFilter, setActiveSubFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("recent");

  // Compute summary stats
  const ownedCount = useMemo(() => books.filter((b) => b.ownedFormats.length > 0).length, [books]);
  const readCount = useMemo(() => books.filter((b) => b.state === "completed").length, [books]);
  const tbrCount = useMemo(() => books.filter((b) => b.state === "tbr").length, [books]);

  const subFilters = SUB_FILTERS[activeGroup];
  const filteredBooks = sortBooks(filterBooks(books, activeGroup, activeSubFilter), sort);

  // Count for each sub-filter badge
  const subFilterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sf of subFilters) {
      counts[sf.key] = filterBooks(books, activeGroup, sf.key).length;
    }
    return counts;
  }, [books, activeGroup, subFilters]);

  function handleGroupChange(group: GroupKey) {
    setActiveGroup(group);
    setActiveSubFilter(SUB_FILTERS[group][0].key);
    setSort("recent");
  }

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-foreground text-2xl font-bold tracking-tight"
         
        >
          Bookshelf
        </h1>
        <span className="text-xs text-muted">
          {ownedCount} owned · {readCount} read · {tbrCount} tbr
        </span>
      </div>

      {/* Top-tier segments */}
      <div className="flex gap-1 rounded-xl bg-surface-alt p-1 mb-4">
        {GROUPS.map((group) => (
          <button
            key={group.key}
            onClick={() => handleGroupChange(group.key)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              activeGroup === group.key
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
                onClick={() => { setActiveSubFilter(sf.key); setSort("recent"); }}
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

      {/* Sort Controls — custom dropdown to avoid native select positioning issues */}
      {filteredBooks.length > 1 && (
        <SortDropdown
          sort={sort}
          onSortChange={setSort}
          showRating={activeGroup === "activity" && activeSubFilter === "completed"}
        />
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
          <p className="text-sm text-muted mb-2">Nothing here yet.</p>
          <Link
            href="/search"
            className="text-sm text-link hover:text-link/80"
          >
            Find books to add
          </Link>
        </div>
      )}
    </div>
  );
}
