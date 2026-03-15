"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { buildCoverUrl, type OLSearchResult } from "@/lib/openlibrary";
import { importFromOpenLibrary } from "@/lib/actions/books";
import { ReadingStateButton } from "@/components/reading-state-button";
import { CompactOwnedButton } from "@/components/compact-owned-button";

interface SearchClientProps {
  isLoggedIn: boolean;
  initialQuery?: string;
}

export default function SearchClient({ isLoggedIn, initialQuery }: SearchClientProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<OLSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [navigating, setNavigating] = useState<string | null>(null);
  const [existingBooks, setExistingBooks] = useState<Record<string, string>>({});
  const [bookStates, setBookStates] = useState<Record<string, string>>({});
  const [bookOwnedFormats, setBookOwnedFormats] = useState<Record<string, string[]>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      setExistingBooks({});
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/openlibrary/search?q=${encodeURIComponent(query.trim())}`
        );
        const data: OLSearchResult[] = await res.json();
        setResults(data);
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

  async function handleNavigateToBook(result: OLSearchResult) {
    setNavigating(result.key);
    // importFromOpenLibrary imports then redirects to /book/[id]
    await importFromOpenLibrary(result);
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title, author, or ISBN..."
        className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {loading && (
        <p className="mt-6 text-center text-sm text-muted">Searching...</p>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="mt-8 text-center">
          <p className="text-sm text-muted">No results found.</p>
          <Link
            href="/search/add"
            className="mt-2 inline-block text-sm text-primary hover:text-primary-dark"
          >
            Can&apos;t find your book? Manually add it to your shelf.
          </Link>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-6 space-y-3">
          {results.map((result) => {
            const coverUrl = buildCoverUrl(result.cover_i, "M");
            const existingId = existingBooks[result.key];
            const currentState = bookStates[result.key] ?? null;

            const coverElement = coverUrl ? (
              <Image
                src={coverUrl}
                alt={`Cover of ${result.title}`}
                width={60}
                height={90}
                className="h-[90px] w-[60px] rounded object-cover hover:opacity-80 transition-opacity"
              />
            ) : (
              <div className="flex h-[90px] w-[60px] items-center justify-center rounded bg-surface-alt text-xs text-muted hover:bg-surface-alt/80 transition-colors">
                No cover
              </div>
            );

            const meta = [
              result.first_publish_year,
              result.number_of_pages_median ? `${result.number_of_pages_median} pp` : null,
            ].filter(Boolean).join(" · ");

            return (
              <div
                key={result.key}
                className="flex gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex-shrink-0">
                  {existingId ? (
                    <Link href={`/book/${existingId}`}>
                      {coverElement}
                    </Link>
                  ) : (
                    <button
                      onClick={() => handleNavigateToBook(result)}
                      disabled={navigating === result.key}
                      className="cursor-pointer disabled:opacity-50"
                    >
                      {coverElement}
                    </button>
                  )}
                </div>
                <div className="flex flex-1 flex-col justify-between">
                  <div>
                    {existingId ? (
                      <Link href={`/book/${existingId}`}>
                        <h3 className="font-medium leading-tight hover:text-primary transition-colors">
                          {result.title}
                        </h3>
                      </Link>
                    ) : (
                      <button
                        onClick={() => handleNavigateToBook(result)}
                        disabled={navigating === result.key}
                        className="text-left cursor-pointer disabled:opacity-50"
                      >
                        <h3 className="font-medium leading-tight hover:text-primary transition-colors">
                          {result.title}
                        </h3>
                      </button>
                    )}
                    {result.author_name && (
                      <p className="mt-0.5 text-sm text-muted">
                        {result.author_name.join(", ")}
                      </p>
                    )}
                    {meta && (
                      <p className="text-xs text-muted">
                        {meta}
                      </p>
                    )}
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
          })}
          <div className="pt-2 text-center">
            <Link
              href="/search/add"
              className="text-sm text-primary hover:text-primary-dark"
            >
              Can&apos;t find your book? Manually add it to your shelf.
            </Link>
          </div>
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
