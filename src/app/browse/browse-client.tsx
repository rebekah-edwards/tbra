"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { NoCover } from "@/components/no-cover";
import type { BrowseBook } from "@/lib/queries/browse";

const SORT_OPTIONS = [
  { key: "popular", label: "Most Popular" },
  { key: "highest_rated", label: "Highest Rated" },
  { key: "newest", label: "Newest" },
  { key: "recently_added", label: "Recently Added" },
  { key: "title", label: "Title A-Z" },
  { key: "pages", label: "Shortest First" },
];

const FICTION_OPTIONS = [
  { key: "", label: "All" },
  { key: "fiction", label: "Fiction" },
  { key: "nonfiction", label: "Non-Fiction" },
];

const LENGTH_OPTIONS = [
  { key: "", label: "Any Length" },
  { key: "short", label: "Under 250p" },
  { key: "medium", label: "250-400p" },
  { key: "long", label: "400+ pages" },
];

const AUDIENCE_OPTIONS = [
  { key: "", label: "All Ages" },
  { key: "adult", label: "Adult" },
  { key: "ya", label: "Young Adult" },
  { key: "mg", label: "Middle Grade" },
];

const PAGE_SIZE = 24;

interface BrowseClientProps {
  isLoggedIn: boolean;
  hasFollows: boolean;
}

export function BrowseClient({ isLoggedIn, hasFollows }: BrowseClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read initial state from URL params
  const [sort, setSort] = useState(searchParams.get("sort") || "popular");
  const [genre, setGenre] = useState(searchParams.get("genre") || "");
  const [fiction, setFiction] = useState(searchParams.get("fiction") || "");
  const [length, setLength] = useState(searchParams.get("length") || "");
  const [audience, setAudience] = useState(searchParams.get("audience") || "");
  const [owned, setOwned] = useState(searchParams.get("owned") || "");
  const [social, setSocial] = useState(searchParams.get("social") || "");
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [books, setBooks] = useState<BrowseBook[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const offsetRef = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  // Sync URL params
  const syncUrl = useCallback((overrides: Record<string, string>) => {
    const params = new URLSearchParams();
    const state = { sort, genre, fiction, length, audience, owned, social, q: query, ...overrides };
    for (const [k, v] of Object.entries(state)) {
      if (v && v !== "popular" && k !== "sort" || (k === "sort" && v !== "popular")) {
        if (v) params.set(k, v);
      }
    }
    // Always include sort if not default
    if (state.sort && state.sort !== "popular") params.set("sort", state.sort);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [sort, genre, fiction, length, audience, owned, social, query, router, pathname]);

  // Fetch books
  const fetchBooks = useCallback(async (offset: number, append: boolean) => {
    if (offset === 0) {
      setLoading(true);
      setError(false);
    } else {
      setLoadingMore(true);
    }

    try {
      const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sort, genre: genre || undefined, fiction: fiction || undefined,
          length: length || undefined, audience: audience || undefined,
          owned: owned || undefined, social: social || undefined,
          query: query || undefined, offset, limit: PAGE_SIZE,
        }),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setBooks((prev) => append ? [...prev, ...data.books] : data.books);
      setTotal(data.total);
      setHasMore(data.hasMore);
      offsetRef.current = offset + PAGE_SIZE;
    } catch {
      if (offset === 0) setError(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort, genre, fiction, length, audience, owned, social, query]);

  // Initial load + reload on filter change
  useEffect(() => {
    offsetRef.current = 0;
    fetchBooks(0, false);
  }, [fetchBooks]);

  // Debounced search
  function handleSearchChange(val: string) {
    setQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      syncUrl({ q: val });
    }, 400);
  }

  function handleFilterChange(key: string, value: string) {
    switch (key) {
      case "sort": setSort(value); break;
      case "genre": setGenre(value); break;
      case "fiction": setFiction(value); break;
      case "length": setLength(value); break;
      case "audience": setAudience(value); break;
      case "owned": setOwned(value); break;
      case "social": setSocial(value); break;
    }
    syncUrl({ [key]: value });
  }

  function clearFilters() {
    setGenre(""); setFiction(""); setLength(""); setAudience("");
    setOwned(""); setSocial(""); setQuery("");
    syncUrl({ genre: "", fiction: "", length: "", audience: "", owned: "", social: "", q: "" });
  }

  const activeFilterCount = [genre, fiction, length, audience, owned, social].filter(Boolean).length;

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Header */}
      <h1 className="text-foreground text-2xl font-bold tracking-tight mb-1">
        Browse Library
      </h1>
      <p className="text-xs text-muted mb-4">
        {total.toLocaleString()} books
      </p>

      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by title or author..."
          className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent"
        />
      </div>

      {/* Sort + filter toggle */}
      <div className="flex items-center gap-2 mb-3">
        <select
          value={sort}
          onChange={(e) => handleFilterChange("sort", e.target.value)}
          className="rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>

        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
            activeFilterCount > 0
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-border bg-surface-alt text-muted hover:text-foreground"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>

        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="text-[10px] text-link hover:text-link/80">
            Clear all
          </button>
        )}
      </div>

      {/* Collapsible filter panel */}
      {filtersOpen && (
        <div className="mb-4 rounded-lg border border-border bg-surface-alt/50 p-3 space-y-2.5">
          {/* Genre */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted uppercase tracking-wider w-16 shrink-0">Genre</label>
            <select
              value={genre}
              onChange={(e) => handleFilterChange("genre", e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
            >
              <option value="">All Genres</option>
              <option value="Fantasy">Fantasy</option>
              <option value="Sci-Fi">Sci-Fi</option>
              <option value="Romance">Romance</option>
              <option value="Thriller">Thriller</option>
              <option value="Mystery">Mystery</option>
              <option value="Horror">Horror</option>
              <option value="Historical Fiction">Historical Fiction</option>
              <option value="Literary Fiction">Literary Fiction</option>
              <option value="Contemporary Romance">Contemporary Romance</option>
              <option value="Dark Fantasy">Dark Fantasy</option>
              <option value="Epic Fantasy">Epic Fantasy</option>
              <option value="Romantasy">Romantasy</option>
              <option value="Grimdark">Grimdark</option>
              <option value="LitRPG">LitRPG</option>
              <option value="Dystopian">Dystopian</option>
              <option value="Adventure">Adventure</option>
              <option value="Crime">Crime</option>
              <option value="Biography">Biography</option>
              <option value="Self-Help">Self-Help</option>
              <option value="Humor">Humor</option>
              <option value="Coming of Age">Coming of Age</option>
              <option value="Anthology">Anthology</option>
            </select>
          </div>

          {/* Fiction */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted uppercase tracking-wider w-16 shrink-0">Type</label>
            <div className="flex gap-1.5">
              {FICTION_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => handleFilterChange("fiction", fiction === o.key ? "" : o.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                    fiction === o.key
                      ? "bg-accent/20 text-accent border border-accent/30"
                      : "bg-surface text-muted hover:text-foreground border border-border"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Length */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted uppercase tracking-wider w-16 shrink-0">Length</label>
            <select
              value={length}
              onChange={(e) => handleFilterChange("length", e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
            >
              {LENGTH_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Audience */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted uppercase tracking-wider w-16 shrink-0">Audience</label>
            <select
              value={audience}
              onChange={(e) => handleFilterChange("audience", e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
            >
              {AUDIENCE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Owned (logged-in only) */}
          {isLoggedIn && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted uppercase tracking-wider w-16 shrink-0">Owned</label>
              <div className="flex gap-1.5">
                {[{ key: "", label: "All" }, { key: "owned", label: "Owned" }, { key: "unowned", label: "Unowned" }].map((o) => (
                  <button
                    key={o.key}
                    onClick={() => handleFilterChange("owned", owned === o.key ? "" : o.key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                      owned === o.key
                        ? "bg-accent/20 text-accent border border-accent/30"
                        : "bg-surface text-muted hover:text-foreground border border-border"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Social (logged-in + has follows) */}
          {isLoggedIn && hasFollows && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted uppercase tracking-wider w-16 shrink-0">Social</label>
              <div className="flex gap-1.5">
                {[
                  { key: "", label: "All" },
                  { key: "friends_read", label: "Friends Read" },
                  { key: "friends_tbr", label: "Friends' TBR" },
                ].map((o) => (
                  <button
                    key={o.key}
                    onClick={() => handleFilterChange("social", social === o.key ? "" : o.key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                      social === o.key
                        ? "bg-neon-blue/20 text-neon-blue border border-neon-blue/30"
                        : "bg-surface text-muted hover:text-foreground border border-border"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="py-12 text-center">
          <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-accent mb-2" />
          <p className="text-sm text-muted">Loading books...</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">Something went wrong loading books.</p>
          <button
            onClick={() => fetchBooks(0, false)}
            className="mt-3 rounded-lg border border-border bg-surface-alt px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-alt/80 transition-colors"
          >
            Try again
          </button>
        </div>
      ) : books.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">No books match your filters.</p>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="mt-2 text-sm text-link hover:text-link/80">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {books.map((book) => (
              <Link
                key={book.id}
                href={`/book/${book.slug || book.id}`}
                className="group block"
              >
                <div className="relative">
                  {book.coverImageUrl ? (
                    <Image
                      src={book.coverImageUrl}
                      alt={`Cover of ${book.title}`}
                      width={120}
                      height={180}
                      className="aspect-[2/3] w-full rounded-lg object-cover book-card-cover transition-shadow"
                      loading="lazy"
                    />
                  ) : (
                    <NoCover title={book.title} className="aspect-[2/3] w-full book-card-cover transition-shadow" size="md" />
                  )}
                  {/* Hover title */}
                  <div className="hidden lg:flex absolute inset-0 rounded-lg bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-start p-2 pointer-events-none">
                    <p className="text-[11px] font-medium text-white leading-tight line-clamp-3">
                      {book.title}
                    </p>
                  </div>
                  {/* Rating badge */}
                  {book.aggregateRating && book.aggregateRating > 0 && (
                    <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
                      {book.aggregateRating.toFixed(1)} ★
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="mt-6 text-center">
              <button
                onClick={() => fetchBooks(offsetRef.current, true)}
                disabled={loadingMore}
                className="rounded-lg border border-border bg-surface-alt px-6 py-2.5 text-sm font-medium text-foreground hover:bg-surface-alt/80 transition-colors disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
