"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { buildCoverUrl, type OLSearchResult } from "@/lib/openlibrary";
import { importFromOpenLibrary } from "@/lib/actions/books";
import { ReadingStateButton } from "@/components/reading-state-button";
import { CompactOwnedButton } from "@/components/compact-owned-button";
import { NoCover } from "@/components/no-cover";

type SearchTab = "books" | "people";

interface UserSearchResult {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
}

interface SearchClientProps {
  isLoggedIn: boolean;
  initialQuery?: string;
}

interface SeriesBookResult {
  id: string;
  title: string;
  coverImageUrl: string | null;
  position: number | null;
  publicationYear: number | null;
  authors: string[];
  currentState: string | null;
  ownedFormats: string[];
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
  sampleBooks: { id: string; title: string; coverImageUrl: string | null }[];
}

export default function SearchClient({ isLoggedIn, initialQuery }: SearchClientProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [activeTab, setActiveTab] = useState<SearchTab>("books");
  const [results, setResults] = useState<OLSearchResult[]>([]);
  const [seriesMatches, setSeriesMatches] = useState<SeriesMatch[]>([]);
  const [authorMatches, setAuthorMatches] = useState<AuthorMatch[]>([]);
  const [peopleResults, setPeopleResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [navigating, setNavigating] = useState<string | null>(null);
  const [existingBooks, setExistingBooks] = useState<Record<string, string>>({});
  const [bookStates, setBookStates] = useState<Record<string, string>>({});
  const [bookOwnedFormats, setBookOwnedFormats] = useState<Record<string, string[]>>({});
  const [bookCovers, setBookCovers] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peopleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setResults([]);
      setSeriesMatches([]);
      setAuthorMatches([]);
      setSearched(false);
      setExistingBooks({});
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        // Search OL, local series, and authors in parallel
        const [res, seriesRes, authorRes] = await Promise.all([
          fetch(`/api/openlibrary/search?q=${encodeURIComponent(query.trim())}`),
          fetch(`/api/series/search?q=${encodeURIComponent(query.trim())}`),
          fetch(`/api/authors/search?q=${encodeURIComponent(query.trim())}`),
        ]);
        const data: OLSearchResult[] = await res.json();
        const seriesData: SeriesMatch[] = await seriesRes.json();
        const authorData: AuthorMatch[] = await authorRes.json();
        setResults(data);
        setSeriesMatches(seriesData);
        setAuthorMatches(authorData);
        setSearched(true);

        // Check which books are already imported
        if (data.length > 0) {
          const keys = data.map((r) => r.key);
          const checkRes = await fetch("/api/books/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keys }),
          });
          const checkData = await checkRes.json();
          setExistingBooks(checkData.existing ?? {});
          setBookStates((prev) => ({ ...prev, ...(checkData.states ?? {}) }));
          setBookOwnedFormats((prev) => ({ ...prev, ...(checkData.ownedFormats ?? {}) }));
          setBookCovers((prev) => ({ ...prev, ...(checkData.covers ?? {}) }));
        } else {
          setExistingBooks({});
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // People search effect
  useEffect(() => {
    if (activeTab !== "people") return;
    if (peopleDebounceRef.current) clearTimeout(peopleDebounceRef.current);

    if (query.trim().length < 2) {
      setPeopleResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    peopleDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        const data: UserSearchResult[] = await res.json();
        setPeopleResults(data);
        setSearched(true);
      } catch {
        setPeopleResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (peopleDebounceRef.current) clearTimeout(peopleDebounceRef.current);
    };
  }, [query, activeTab]);

  async function handleNavigateToBook(result: OLSearchResult) {
    setNavigating(result.key);
    // importFromOpenLibrary imports then redirects to /book/[id]
    await importFromOpenLibrary(result);
  }

  function renderBookCard(result: OLSearchResult) {
    const coverUrl = bookCovers[result.key] ?? buildCoverUrl(result.cover_i, "M");
    const existingId = existingBooks[result.key] ?? (result as Record<string, unknown>)._localBookId as string | undefined;
    const currentState = bookStates[result.key] ?? null;
    const localCoverUrl = (result as Record<string, unknown>)._localCoverUrl as string | undefined;
    const localSlug = (result as Record<string, unknown>)._localSlug as string | undefined;
    const effectiveCover = coverUrl || localCoverUrl;
    const bookHref = existingId ? `/book/${localSlug || existingId}` : undefined;

    const coverElement = effectiveCover ? (
      <Image
        src={effectiveCover}
        alt={`Cover of ${result.title}`}
        width={60}
        height={90}
        className="h-[90px] w-[60px] rounded object-cover hover:opacity-80 transition-opacity"
      />
    ) : (
      <NoCover title={result.title} className="h-[90px] w-[60px]" size="sm" />
    );

    const meta = [
      result.first_publish_year,
      result.number_of_pages_median ? `${result.number_of_pages_median} pp` : null,
    ].filter(Boolean).join(" · ");

    return (
      <div key={result.key} className="flex gap-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex-shrink-0">
          {bookHref ? (
            <Link href={bookHref}>{coverElement}</Link>
          ) : (
            <button onClick={() => handleNavigateToBook(result)} disabled={navigating === result.key} className="cursor-pointer disabled:opacity-50">
              {coverElement}
            </button>
          )}
        </div>
        <div className="flex flex-1 flex-col justify-between">
          <div>
            {bookHref ? (
              <Link href={bookHref}>
                <h3 className="font-medium leading-tight hover:text-link transition-colors">
                  {result.englishTitle ?? result.title}
                </h3>
              </Link>
            ) : (
              <button onClick={() => handleNavigateToBook(result)} disabled={navigating === result.key} className="text-left cursor-pointer disabled:opacity-50">
                <h3 className="font-medium leading-tight hover:text-link transition-colors">
                  {result.englishTitle ?? result.title}
                </h3>
              </button>
            )}
            {result.author_name && (
              <p className="mt-0.5 text-sm text-muted">{result.author_name.join(", ")}</p>
            )}
            {meta && <p className="text-xs text-muted">{meta}</p>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <ReadingStateButton
              bookId={existingId ?? undefined}
              olResult={existingId ? undefined : result}
              currentState={currentState}
              isLoggedIn={isLoggedIn}
              compact
              onStateChange={(newState) => {
                setBookStates((prev) => {
                  const next = { ...prev };
                  if (newState) next[result.key] = newState;
                  else delete next[result.key];
                  return next;
                });
              }}
              onImported={(olKey, newBookId) => {
                setExistingBooks((prev) => ({ ...prev, [olKey]: newBookId }));
              }}
            />
            <CompactOwnedButton
              bookId={existingId ?? undefined}
              olResult={existingId ? undefined : result}
              currentFormats={bookOwnedFormats[result.key] ?? []}
              isLoggedIn={isLoggedIn}
              onFormatsChange={(formats) => {
                setBookOwnedFormats((prev) => ({ ...prev, [result.key]: formats }));
              }}
              onImported={(olKey, newBookId) => {
                setExistingBooks((prev) => ({ ...prev, [olKey]: newBookId }));
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-4 rounded-lg bg-surface-alt p-1">
        <button
          type="button"
          onClick={() => { setActiveTab("books"); setSearched(false); }}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "books"
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          Books
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("people"); setSearched(false); }}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "people"
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          People
        </button>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={activeTab === "books" ? "Search by title, author, or ISBN..." : "Search by name or username..."}
        className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm placeholder-muted focus:border-neon-blue focus:outline-none focus:ring-1 focus:ring-neon-blue"
      />

      {loading && (
        <p className="mt-6 text-center text-sm text-muted">Searching...</p>
      )}

      {!loading && searched && activeTab === "books" && results.length === 0 && seriesMatches.length === 0 && authorMatches.length === 0 && (
        <div className="mt-8 text-center">
          <p className="text-sm text-muted">No results found.</p>
          <Link
            href="/search/add"
            className="mt-2 inline-block text-sm text-link hover:text-link/80"
          >
            Can&apos;t find your book? Manually add it to your shelf.
          </Link>
        </div>
      )}

      {!loading && activeTab === "books" && seriesMatches.length > 0 && (
        <div className="mt-6 space-y-4">
          {seriesMatches.map((s) => (
            <div key={s.id}>
              {/* Series header card */}
              <Link
                href={`/search?series=${encodeURIComponent(s.id)}`}
                className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3 hover:bg-accent/10 transition-colors"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                    <path d="M8 7h6" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight">{s.name}</p>
                  <p className="text-xs text-muted">{s.bookCount} book{s.bookCount !== 1 ? "s" : ""} in series</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted flex-shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>

              {/* Series books */}
              {s.books.length > 0 && (
                <div className="mt-2 space-y-2 pl-2">
                  {s.books.map((book) => (
                    <div
                      key={book.id}
                      className="flex gap-3 rounded-lg border border-border bg-surface p-3"
                    >
                      <Link href={`/book/${book.slug || book.id}`} className="flex-shrink-0">
                        {book.coverImageUrl ? (
                          <Image
                            src={book.coverImageUrl}
                            alt={`Cover of ${book.title}`}
                            width={48}
                            height={72}
                            className="h-[72px] w-[48px] rounded object-cover hover:opacity-80 transition-opacity"
                          />
                        ) : (
                          <NoCover title={book.title} className="h-[72px] w-[48px]" size="sm" />
                        )}
                      </Link>
                      <div className="flex flex-1 flex-col justify-between min-w-0">
                        <div>
                          <Link href={`/book/${book.slug || book.id}`}>
                            <h3 className="text-sm font-medium leading-tight hover:text-link transition-colors truncate">
                              {book.title}
                            </h3>
                          </Link>
                          <p className="text-xs text-muted">
                            {[
                              book.position != null
                                ? Number.isInteger(book.position) ? `Book ${book.position}` : `Novella ${book.position}`
                                : null,
                              book.authors.length > 0 ? book.authors.join(", ") : null,
                              book.publicationYear,
                            ].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <ReadingStateButton
                            bookId={book.id}
                            currentState={book.currentState}
                            isLoggedIn={isLoggedIn}
                            compact
                            onStateChange={() => {}}
                          />
                          <CompactOwnedButton
                            bookId={book.id}
                            currentFormats={book.ownedFormats}
                            isLoggedIn={isLoggedIn}
                            onFormatsChange={() => {}}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {s.bookCount > s.books.length && (
                    <Link
                      href={`/search?series=${encodeURIComponent(s.id)}`}
                      className="block text-center text-xs font-medium text-link py-1.5 hover:text-link/80 transition-colors"
                    >
                      View all {s.bookCount} books in series →
                    </Link>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === "books" && authorMatches.length > 0 && (
        <div className="mt-6 space-y-3">
          {authorMatches.map((a) => (
            <Link
              key={a.id}
              href={`/author/${a.id}`}
              className="flex items-center gap-3 rounded-lg border border-neon-blue/30 bg-neon-blue/5 p-3 hover:bg-neon-blue/10 transition-colors"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon-blue/15 text-neon-blue">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">{a.name}</p>
                <p className="text-xs text-muted">{a.bookCount} book{a.bookCount !== 1 ? "s" : ""} in library</p>
              </div>
              {a.sampleBooks.length > 0 && (
                <div className="flex -space-x-2">
                  {a.sampleBooks.slice(0, 3).map((book) =>
                    book.coverImageUrl ? (
                      <Image
                        key={book.id}
                        src={book.coverImageUrl}
                        alt={book.title}
                        width={28}
                        height={42}
                        className="h-[42px] w-[28px] rounded object-cover border-2 border-surface"
                      />
                    ) : (
                      <NoCover key={book.id} title={book.title} className="h-[42px] w-[28px] border-2 border-surface" size="sm" />
                    )
                  )}
                </div>
              )}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted flex-shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {!loading && activeTab === "books" && results.length > 0 && (() => {
        // Split results into local (in tbra library) and OL (external) groups
        const localResults = results.filter((r) => (r as Record<string, unknown>)._localBookId || existingBooks[r.key]);
        const olResults = results.filter((r) => !(r as Record<string, unknown>)._localBookId && !existingBooks[r.key]);

        return (
          <>
          {localResults.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">In tbr*a library</p>
              <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4">
                {localResults.map((result) => renderBookCard(result))}
              </div>
            </div>
          )}
          {olResults.length > 0 && (
            <div className="mt-6">
              {localResults.length > 0 && (
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">More results</p>
              )}
              <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4">
                {olResults.map((result) => renderBookCard(result))}
              </div>
            </div>
          )}
          </>
        );
      })()}

      {!loading && activeTab === "books" && results.length > 0 && (
        <div className="pt-2 text-center">
          <Link
            href="/search/add"
            className="text-sm text-link hover:text-link/80"
          >
            Can&apos;t find your book? Manually add it to your shelf.
          </Link>
        </div>
      )}

      {/* People search results */}
      {!loading && activeTab === "people" && searched && peopleResults.length === 0 && (
        <div className="mt-8 text-center">
          <p className="text-sm text-muted">No people found.</p>
        </div>
      )}

      {!loading && activeTab === "people" && peopleResults.length > 0 && (
        <div className="mt-6 space-y-2">
          {peopleResults.map((user) => (
            <Link
              key={user.id}
              href={user.username ? `/u/${user.username}` : "#"}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 hover:bg-surface-alt transition-colors"
            >
              <div
                className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold overflow-hidden ${
                  user.avatarUrl ? "" : "text-black"
                }`}
                style={!user.avatarUrl ? { backgroundColor: "#a3e635" } : undefined}
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted flex-shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {!loading && !searched && (
        <p className="mt-8 text-center text-sm text-muted">
          Type at least 2 characters to search.
        </p>
      )}
    </div>
  );
}
