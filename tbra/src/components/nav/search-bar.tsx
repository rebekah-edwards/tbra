"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import type { OLSearchResult } from "@/lib/openlibrary";

interface SearchBarProps {
  isLoggedIn: boolean;
}

interface ExistingBooks {
  existing: Record<string, string>;
  states: Record<string, string>;
  ownedFormats: Record<string, string[]>;
}

export function SearchBar({ isLoggedIn }: SearchBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OLSearchResult[]>([]);
  const [existingBooks, setExistingBooks] = useState<ExistingBooks>({
    existing: {},
    states: {},
    ownedFormats: {},
  });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const pathname = usePathname();

  // Close on route change
  useEffect(() => {
    setExpanded(false);
    setQuery("");
    setResults([]);
  }, [pathname]);

  // Focus input when expanded
  useEffect(() => {
    if (expanded) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [expanded]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && expanded) {
        setExpanded(false);
        setQuery("");
        setResults([]);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/openlibrary/search?q=${encodeURIComponent(q.trim())}`
        );
        if (res.ok) {
          const data: OLSearchResult[] = await res.json();
          setResults(data.slice(0, 5));

          // Check which are already in DB
          if (data.length > 0) {
            const keys = data.slice(0, 5).map((d) => d.key);
            const checkRes = await fetch("/api/books/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ keys }),
            });
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              setExistingBooks(checkData);
            }
          }
        }
      } catch {
        // ignore
      }
      setLoading(false);
    },
    []
  );

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => search(value), 300);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length >= 2) {
      setExpanded(false);
      setResults([]);
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  function handleResultClick(result: OLSearchResult) {
    const existingId = existingBooks.existing[result.key];
    if (existingId) {
      setExpanded(false);
      setQuery("");
      setResults([]);
      router.push(`/book/${existingId}`);
    } else {
      // Navigate to search page with query to show full results
      setExpanded(false);
      setResults([]);
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  function buildCoverUrl(coverId?: number) {
    if (!coverId) return null;
    return `https://covers.openlibrary.org/b/id/${coverId}-S.jpg`;
  }

  // Search icon button (collapsed state)
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center justify-center rounded-full p-2 text-muted hover:text-foreground transition-colors"
        aria-label="Search"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    );
  }

  // Expanded state — full-width overlay
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[55] bg-black/50"
        onClick={() => {
          setExpanded(false);
          setQuery("");
          setResults([]);
        }}
      />

      {/* Search overlay */}
      <div
        ref={containerRef}
        className="fixed top-0 left-0 right-0 z-[56] bg-surface border-b border-border shadow-xl"
      >
        {/* Input row */}
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setQuery("");
              setResults([]);
            }}
            className="flex-shrink-0 text-muted hover:text-foreground transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Search books..."
            className="flex-1 bg-transparent text-foreground text-base placeholder:text-muted outline-none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {loading && (
            <div className="flex-shrink-0 w-4 h-4 border-2 border-muted border-t-primary rounded-full animate-spin" />
          )}
          {query && !loading && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                inputRef.current?.focus();
              }}
              className="flex-shrink-0 text-muted hover:text-foreground transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </form>

        {/* Results dropdown */}
        {results.length > 0 && (
          <div className="mx-auto max-w-3xl px-4 pb-3">
            <div className="rounded-xl border border-border bg-surface-alt overflow-hidden">
              {results.map((result) => {
                const coverUrl = buildCoverUrl(result.cover_i);
                const existingId = existingBooks.existing[result.key];
                const state = existingBooks.states[result.key];

                return (
                  <button
                    key={result.key}
                    onClick={() => handleResultClick(result)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface transition-colors border-b border-border/50 last:border-0"
                  >
                    {/* Cover */}
                    <div className="flex-shrink-0 w-10 h-[60px] rounded overflow-hidden bg-surface">
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] text-muted">
                          No cover
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {result.title}
                      </p>
                      {result.author_name && result.author_name.length > 0 && (
                        <p className="text-xs text-muted truncate">
                          {result.author_name.slice(0, 2).join(", ")}
                        </p>
                      )}
                      {result.first_publish_year && (
                        <p className="text-xs text-muted/60">
                          {result.first_publish_year}
                        </p>
                      )}
                    </div>

                    {/* Status badge */}
                    <div className="flex-shrink-0">
                      {existingId ? (
                        <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                          {state === "completed"
                            ? "Finished"
                            : state === "currently_reading"
                              ? "Reading"
                              : state === "tbr"
                                ? "TBR"
                                : state === "paused"
                                  ? "Paused"
                                  : state === "dnf"
                                    ? "DNF"
                                    : "In library"}
                        </span>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/40">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Show all results */}
              <Link
                href={`/search?q=${encodeURIComponent(query.trim())}`}
                onClick={() => {
                  setExpanded(false);
                  setResults([]);
                }}
                className="block w-full px-3 py-2.5 text-center text-xs font-medium text-primary hover:bg-surface transition-colors"
              >
                Show all results
              </Link>
            </div>
          </div>
        )}

        {/* No results state */}
        {query.trim().length >= 2 && !loading && results.length === 0 && (
          <div className="mx-auto max-w-3xl px-4 pb-3">
            <p className="text-sm text-muted text-center py-4">
              No books found for &ldquo;{query}&rdquo;
            </p>
          </div>
        )}
      </div>
    </>
  );
}
