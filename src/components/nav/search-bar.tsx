"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { NoCover } from "@/components/no-cover";

interface SearchBarProps {
  isLoggedIn: boolean;
}

interface LocalBookResult {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  publicationYear: number | null;
  state: string | null;
}

interface SeriesBookResult {
  id: string;
  title: string;
  coverImageUrl: string | null;
  position: number | null;
}

interface SeriesMatch {
  id: string;
  name: string;
  bookCount: number;
  books: SeriesBookResult[];
}

interface AuthorMatch {
  id: string;
  name: string;
  bookCount: number;
}

interface UserResult {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export function SearchBar({ isLoggedIn }: SearchBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [bookResults, setBookResults] = useState<LocalBookResult[]>([]);
  const [seriesMatches, setSeriesMatches] = useState<SeriesMatch[]>([]);
  const [authorMatches, setAuthorMatches] = useState<AuthorMatch[]>([]);
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  // Track animation state for enter/exit transitions
  const [animating, setAnimating] = useState(false);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const searchIdRef = useRef(0);
  const router = useRouter();
  const pathname = usePathname();

  // Close on route change
  useEffect(() => {
    collapse();
  }, [pathname]);

  // Animate open when expanded changes to true
  useEffect(() => {
    if (expanded) {
      // Mount first, then trigger animation on next frame
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimating(true);
          // Focus after animation completes (300ms) with extra buffer for mobile
          setTimeout(() => {
            inputRef.current?.focus();
            // Double-tap focus for mobile browsers that block async focus
            setTimeout(() => inputRef.current?.focus(), 50);
          }, 320);
        });
      });
    }
  }, [expanded]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && expanded) {
        collapse();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  function collapse() {
    setAnimating(false);
    // Wait for exit animation to complete before unmounting
    setTimeout(() => {
      setExpanded(false);
      setVisible(false);
      setQuery("");
      setBookResults([]);
      setSeriesMatches([]);
      setAuthorMatches([]);
      setUserResults([]);
    }, 250);
  }

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setBookResults([]);
        setSeriesMatches([]);
        setAuthorMatches([]);
        setUserResults([]);
        setLoading(false);
        return;
      }

      // Cancel any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      // Track request ID to ignore stale responses
      const requestId = ++searchIdRef.current;

      setLoading(true);
      try {
        const signal = controller.signal;
        const [booksRes, seriesRes, authorRes, usersRes] = await Promise.all([
          fetch(`/api/books/search?q=${encodeURIComponent(q.trim())}`, { signal }),
          fetch(`/api/series/search?q=${encodeURIComponent(q.trim())}`, { signal }),
          fetch(`/api/authors/search?q=${encodeURIComponent(q.trim())}`, { signal }),
          fetch(`/api/users/search?q=${encodeURIComponent(q.trim())}`, { signal }),
        ]);

        // If a newer search has started, discard these results
        if (requestId !== searchIdRef.current) return;

        if (booksRes.ok) {
          const booksData: LocalBookResult[] = await booksRes.json();
          setBookResults(booksData);
        }
        if (seriesRes.ok) {
          const seriesData: SeriesMatch[] = await seriesRes.json();
          setSeriesMatches(seriesData);
        }
        if (authorRes.ok) {
          const authorData: AuthorMatch[] = await authorRes.json();
          setAuthorMatches(authorData);
        }
        if (usersRes.ok) {
          const userData: UserResult[] = await usersRes.json();
          setUserResults(userData.slice(0, 3));
        }
        setLoading(false);
      } catch (err) {
        // Only clear loading if this wasn't an abort
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (requestId === searchIdRef.current) {
          setLoading(false);
        }
      }
    },
    []
  );

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      // Cancel in-flight requests and clear results
      if (abortRef.current) abortRef.current.abort();
      searchIdRef.current++;
      setBookResults([]);
      setSeriesMatches([]);
      setAuthorMatches([]);
      setUserResults([]);
      setLoading(false);
      return;
    }
    // Don't clear existing results — keep them visible while loading new ones
    debounceRef.current = setTimeout(() => search(value), 300);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length >= 2) {
      collapse();
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  function stateLabel(state: string): string | null {
    switch (state) {
      case "completed": return "Finished";
      case "currently_reading": return "Reading";
      case "tbr": return "TBR";
      case "paused": return "Paused";
      case "dnf": return "DNF";
      default: return null;
    }
  }

  const hasResults = seriesMatches.length > 0 || authorMatches.length > 0 || userResults.length > 0 || bookResults.length > 0;
  // Show dropdown when we have results OR when loading has completed with no results
  // Don't hide results while loading new ones (prevents flash/disappearing results)
  const showDropdown = query.trim().length >= 2 && (hasResults || !loading);
  const noResults = showDropdown && !hasResults && !loading;

  return (
    <>
      {/* Search icon trigger — always rendered */}
      <button
        onClick={() => {
          setExpanded(true);
          // iOS/PWA: claim keyboard focus synchronously within the tap gesture
          // by focusing a temporary input, then transfer to the real one once rendered
          const tmp = document.createElement("input");
          tmp.style.position = "fixed";
          tmp.style.opacity = "0";
          tmp.style.top = "0";
          tmp.style.left = "0";
          tmp.style.width = "1px";
          tmp.style.height = "1px";
          document.body.appendChild(tmp);
          tmp.focus();
          setTimeout(() => {
            inputRef.current?.focus();
            tmp.remove();
          }, 350);
        }}
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

      {/* Expanded overlay — only mounted when visible */}
      {visible && (
        <>
          {/* Backdrop with blur */}
          <div
            className="fixed inset-0 z-[55] transition-all duration-300 ease-out"
            style={{
              backgroundColor: animating ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0)",
              backdropFilter: animating ? "blur(4px)" : "blur(0px)",
              WebkitBackdropFilter: animating ? "blur(4px)" : "blur(0px)",
            }}
            onClick={collapse}
          />

          {/* Search overlay bar */}
          <div
            ref={containerRef}
            className="fixed top-0 left-0 right-0 z-[56] flex items-start justify-center pt-[calc(env(safe-area-inset-top)+8px)] px-3"
          >
            <div
              className="w-full max-w-2xl lg:max-w-3xl transition-all duration-300 ease-out"
              style={{
                transform: animating ? "scale(1) translateY(0)" : "scale(0.9) translateY(-10px)",
                opacity: animating ? 1 : 0,
              }}
            >
              {/* Rounded pill search bar */}
              <form
                onSubmit={handleSubmit}
                className="flex items-center gap-3 rounded-full bg-surface border border-border shadow-xl px-4 py-3"
              >
                {/* Search icon inside bar */}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-shrink-0 text-muted"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>

                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => handleInput(e.target.value)}
                  placeholder="Search books, authors, series, readers..."
                  className="flex-1 bg-transparent text-foreground text-base placeholder:text-muted outline-none min-w-0"
                  autoComplete="off"
                  autoCorrect="off"
                  autoFocus
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
                      setBookResults([]);
                      setSeriesMatches([]);
                      setAuthorMatches([]);
                      setUserResults([]);
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

                {/* Cancel button */}
                <button
                  type="button"
                  onClick={collapse}
                  className="flex-shrink-0 text-xs font-medium text-muted hover:text-foreground transition-colors ml-1"
                >
                  Cancel
                </button>
              </form>

              {/* Results dropdown — appears below the pill */}
              {(hasResults || noResults) && (
                <div
                  className="mt-2 rounded-2xl border border-border bg-surface shadow-xl overflow-hidden transition-all duration-200 ease-out"
                  style={{
                    maxHeight: "60vh",
                    overflowY: "auto",
                  }}
                >
                  {hasResults && (
                    <>
                      {/* Series matches with books */}
                      {seriesMatches.map((s) => (
                        <div key={s.id} className="border-b border-border/50">
                          <Link
                            href={`/search?series=${encodeURIComponent(s.id)}`}
                            onClick={collapse}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-alt transition-colors"
                          >
                            <div className="flex-shrink-0 w-10 h-[60px] rounded overflow-hidden bg-primary/10 flex items-center justify-center">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                                <path d="M8 7h6" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                              <p className="text-xs text-muted">{s.bookCount} book{s.bookCount !== 1 ? "s" : ""} in series</p>
                            </div>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/40 flex-shrink-0">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </Link>
                          {/* Compact series books */}
                          {s.books.length > 0 && (
                            <div className="px-4 pb-2.5 flex gap-2 overflow-x-auto">
                              {s.books.slice(0, 6).map((book) => (
                                <Link
                                  key={book.id}
                                  href={`/book/${book.slug || book.id}`}
                                  onClick={collapse}
                                  className="flex-shrink-0 group"
                                  title={book.title}
                                >
                                  {book.coverImageUrl ? (
                                    <img
                                      src={book.coverImageUrl}
                                      alt=""
                                      className="w-[40px] h-[60px] rounded object-cover group-hover:opacity-80 transition-opacity"
                                    />
                                  ) : (
                                    <div className="w-[40px] h-[60px] rounded bg-surface-alt flex items-center justify-center text-[7px] text-muted leading-tight text-center px-0.5">
                                      {book.position != null ? `#${book.position}` : "?"}
                                    </div>
                                  )}
                                </Link>
                              ))}
                              {s.books.length > 6 && (
                                <Link
                                  href={`/search?series=${encodeURIComponent(s.id)}`}
                                  onClick={collapse}
                                  className="flex-shrink-0 w-[40px] h-[60px] rounded bg-surface-alt/50 flex items-center justify-center text-[10px] text-muted hover:text-foreground transition-colors"
                                >
                                  +{s.books.length - 6}
                                </Link>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {/* Author matches */}
                      {authorMatches.map((a) => (
                        <Link
                          key={a.id}
                          href={`/author/${a.id}`}
                          onClick={collapse}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-alt transition-colors border-b border-border/50"
                        >
                          <div className="flex-shrink-0 w-10 h-[60px] rounded overflow-hidden bg-neon-blue/10 flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                            <p className="text-xs text-muted">{a.bookCount} book{a.bookCount !== 1 ? "s" : ""}</p>
                          </div>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/40 flex-shrink-0">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </Link>
                      ))}
                      {/* People results */}
                      {userResults.map((user) => (
                        <Link
                          key={user.id}
                          href={user.username ? `/u/${user.username}` : "#"}
                          onClick={collapse}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-alt transition-colors border-b border-border/50"
                        >
                          <div
                            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold overflow-hidden text-black"
                            style={{ backgroundColor: user.avatarUrl ? undefined : "#a3e635" }}
                          >
                            {user.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              (user.displayName?.[0] ?? "?").toUpperCase()
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {user.displayName ?? "Unknown"}
                            </p>
                            {user.username && (
                              <p className="text-xs text-muted truncate">@{user.username}</p>
                            )}
                          </div>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/40 flex-shrink-0">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </Link>
                      ))}
                      {/* Local book results — each links directly to the book page */}
                      {bookResults.map((book) => (
                        <Link
                          key={book.id}
                          href={`/book/${book.slug || book.id}`}
                          onClick={collapse}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-alt transition-colors border-b border-border/50 last:border-0"
                        >
                          {/* Cover */}
                          <div className="flex-shrink-0 w-10 h-[60px] rounded overflow-hidden bg-surface-alt">
                            {book.coverImageUrl ? (
                              <img
                                src={book.coverImageUrl}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <NoCover title={book.title} className="w-full h-full" size="sm" />
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {book.title}
                            </p>
                            {book.authors.length > 0 && (
                              <p className="text-xs text-muted truncate">
                                {book.authors.slice(0, 2).join(", ")}
                              </p>
                            )}
                            {book.publicationYear && (
                              <p className="text-xs text-muted/60">
                                {book.publicationYear}
                              </p>
                            )}
                          </div>

                          {/* Status badge */}
                          <div className="flex-shrink-0">
                            {book.state ? (
                              <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                {stateLabel(book.state)}
                              </span>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/40">
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            )}
                          </div>
                        </Link>
                      ))}
                    </>
                  )}

                  {/* No results state */}
                  {noResults && (
                    <div className="py-5 px-4 text-center">
                      <p className="text-sm text-muted">No books found</p>
                    </div>
                  )}

                  {/* Footer link — always shown when dropdown is visible */}
                  <Link
                    href={`/search?q=${encodeURIComponent(query.trim())}`}
                    onClick={collapse}
                    className="block w-full px-4 py-2.5 text-center text-xs text-muted hover:text-foreground hover:bg-surface-alt transition-colors border-t border-border/50"
                  >
                    See more results or add a book
                  </Link>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
