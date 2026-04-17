"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Person {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
}

export function PeopleSearchClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      if (abortRef.current) abortRef.current.abort();
      setResults([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const id = ++requestIdRef.current;
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (id !== requestIdRef.current) return;
        if (res.ok) {
          const data = (await res.json()) as Person[];
          setResults(data);
        }
        setSearched(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
        setSearched(true);
      } finally {
        if (id === requestIdRef.current) setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="mt-6">
      <div className="relative">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or @username"
          autoFocus
          className="w-full rounded-full border border-border bg-surface py-3 pl-11 pr-4 text-sm placeholder-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="mt-4 space-y-2">
        {loading && query.trim().length >= 2 && (
          <p className="text-sm text-muted px-1">Searching…</p>
        )}
        {!loading && searched && results.length === 0 && query.trim().length >= 2 && (
          <p className="text-sm text-muted px-1">
            No readers found for &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
        {!loading && results.length > 0 && (
          <ul className="space-y-2">
            {results.map((person) => (
              <li key={person.id}>
                <Link
                  href={person.username ? `/u/${person.username}` : "#"}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 hover:bg-surface-alt transition-colors"
                >
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold overflow-hidden text-black"
                    style={{
                      backgroundColor: person.avatarUrl ? undefined : "#a3e635",
                    }}
                  >
                    {person.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={person.avatarUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      (person.displayName?.[0] ?? person.username?.[0] ?? "?").toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight truncate">
                      {person.displayName ?? person.username ?? "Unknown"}
                    </p>
                    {person.username && (
                      <p className="text-xs text-muted truncate">@{person.username}</p>
                    )}
                    {person.bio && (
                      <p className="mt-0.5 text-xs text-muted/80 line-clamp-1">
                        {person.bio}
                      </p>
                    )}
                  </div>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted/60 flex-shrink-0"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
