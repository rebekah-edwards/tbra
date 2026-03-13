"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { importFromOpenLibrary } from "@/lib/actions/books";
import { buildCoverUrl, type OLSearchResult } from "@/lib/openlibrary";

export default function SearchClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OLSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/openlibrary/search?q=${encodeURIComponent(query.trim())}`
        );
        const data = await res.json();
        setResults(data);
        setSearched(true);
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

  async function handleImport(result: OLSearchResult) {
    setImporting(result.key);
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
            Can&apos;t find your book? Add it manually.
          </Link>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-6 space-y-3">
          {results.map((result) => {
            const coverUrl = buildCoverUrl(result.cover_i, "M");
            const isImporting = importing === result.key;
            return (
              <div
                key={result.key}
                className="flex gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <button
                  onClick={() => handleImport(result)}
                  disabled={isImporting}
                  className="flex-shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {coverUrl ? (
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
                  )}
                </button>
                <div className="flex flex-1 flex-col justify-between">
                  <div>
                    <button
                      onClick={() => handleImport(result)}
                      disabled={isImporting}
                      className="text-left cursor-pointer disabled:opacity-50"
                    >
                      <h3 className="font-medium leading-tight hover:text-primary transition-colors">
                        {result.title}
                      </h3>
                    </button>
                    {result.author_name && (
                      <p className="mt-0.5 text-sm text-muted">
                        {result.author_name.join(", ")}
                      </p>
                    )}
                    {result.first_publish_year && (
                      <p className="text-xs text-muted">
                        {result.first_publish_year}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleImport(result)}
                    disabled={isImporting}
                    className="mt-2 self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                  >
                    {isImporting ? "Importing..." : "Import to tbr(a)"}
                  </button>
                </div>
              </div>
            );
          })}
          <div className="pt-2 text-center">
            <Link
              href="/search/add"
              className="text-sm text-primary hover:text-primary-dark"
            >
              Can&apos;t find your book? Add it manually.
            </Link>
          </div>
        </div>
      )}

      {!loading && !searched && (
        <p className="mt-8 text-center text-sm text-muted">
          Type at least 2 characters to search Open Library.
        </p>
      )}
    </div>
  );
}
