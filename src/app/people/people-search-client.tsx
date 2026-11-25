"use client";

import { useEffect, useRef, useState } from "react";
import { ReaderRow } from "@/components/ui/reader-row";

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
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted pointer-events-none"
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
          className="field-glass w-full pl-11 pr-4 text-base"
        />
      </div>

      <div className="mt-4 space-y-2">
        {loading && query.trim().length >= 2 && (
          <p className="text-sm text-muted text-center py-2">Searching…</p>
        )}
        {!loading && searched && results.length === 0 && query.trim().length >= 2 && (
          <p className="text-sm text-muted text-center py-2">
            No readers found for &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
        {query.trim().length < 2 && (
          <div className="card-glass mt-2 flex flex-col items-center px-6 py-9 text-center">
            <span className="orb-glass mb-3 h-14 w-14">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <p className="font-heading text-base font-semibold text-foreground">Find your reading people</p>
            <p className="mt-1 max-w-xs text-sm text-muted">
              Type at least two letters of a name or @username. Follow readers to see what they&apos;re reading.
            </p>
          </div>
        )}
        {!loading && results.length > 0 && (
          <ul className="space-y-2">
            {results.map((person) => (
              <li key={person.id}>
                <ReaderRow
                  href={person.username ? `/u/${person.username}` : null}
                  avatarUrl={person.avatarUrl}
                  name={person.displayName ?? person.username ?? "Unknown"}
                  username={person.username}
                  bio={person.bio}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
