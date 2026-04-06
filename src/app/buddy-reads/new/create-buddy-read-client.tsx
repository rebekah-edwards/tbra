"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { NoCover } from "@/components/no-cover";
import { createBuddyRead } from "@/lib/actions/buddy-reads";

interface BookResult {
  id: string;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
}

interface CreateBuddyReadClientProps {
  prefillBook: { id: string; title: string; coverImageUrl: string | null } | null;
}

export function CreateBuddyReadClient({ prefillBook }: CreateBuddyReadClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Book search state
  const [selectedBook, setSelectedBook] = useState<{
    id: string;
    title: string;
    coverImageUrl: string | null;
  } | null>(prefillBook);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Form fields
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.books?.slice(0, 8) ?? []);
          setShowDropdown(true);
        }
      } catch {
        /* ignore */
      }
    }, 300);
  }, []);

  function selectBook(book: BookResult) {
    setSelectedBook({
      id: book.id,
      title: book.title,
      coverImageUrl: book.coverImageUrl,
    });
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
  }

  function clearBook() {
    setSelectedBook(null);
    setSearchQuery("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!selectedBook) {
      setError("Please select a book.");
      return;
    }

    startTransition(async () => {
      const result = await createBuddyRead(
        selectedBook.id,
        description.trim() || undefined,
        isPublic,
        startDate || undefined,
        endDate || undefined,
      );

      if (result.success && result.slug) {
        router.push(`/buddy-reads/${result.slug}`);
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Book selection */}
      <div>
        <label className="block text-sm font-semibold text-foreground mb-1.5">
          Book
        </label>
        {selectedBook ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
            <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded">
              {selectedBook.coverImageUrl ? (
                <Image
                  src={selectedBook.coverImageUrl}
                  alt={selectedBook.title}
                  width={40}
                  height={56}
                  className="h-full w-full object-cover"
                />
              ) : (
                <NoCover title={selectedBook.title} size="sm" />
              )}
            </div>
            <span className="flex-1 text-sm font-medium text-foreground truncate">
              {selectedBook.title}
            </span>
            <button
              type="button"
              onClick={clearBook}
              className="text-muted hover:text-foreground transition-colors"
              aria-label="Remove book"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ) : (
          <div ref={searchRef} className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search for a book..."
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[#a3e635]/50"
            />
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface shadow-xl">
                {searchResults.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => selectBook(book)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-alt transition-colors"
                  >
                    <div className="h-10 w-7 flex-shrink-0 overflow-hidden rounded">
                      {book.coverImageUrl ? (
                        <Image
                          src={book.coverImageUrl}
                          alt={book.title}
                          width={28}
                          height={40}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <NoCover title={book.title} size="sm" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {book.title}
                      </p>
                      {book.authors?.length > 0 && (
                        <p className="text-xs text-muted truncate">
                          {book.authors.join(", ")}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <label htmlFor="br-desc" className="block text-sm font-semibold text-foreground mb-1.5">
          Description <span className="text-muted font-normal">(optional)</span>
        </label>
        <textarea
          id="br-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this buddy read about?"
          rows={3}
          maxLength={500}
          className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[#a3e635]/50 resize-none"
        />
      </div>

      {/* Public toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Public</p>
          <p className="text-xs text-muted">Anyone can find and request to join</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPublic}
          onClick={() => setIsPublic(!isPublic)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isPublic ? "bg-[#a3e635]" : "bg-border"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              isPublic ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="br-start" className="block text-sm font-semibold text-foreground mb-1.5">
            Start date <span className="text-muted font-normal">(optional)</span>
          </label>
          <input
            id="br-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#a3e635]/50"
          />
        </div>
        <div>
          <label htmlFor="br-end" className="block text-sm font-semibold text-foreground mb-1.5">
            End date <span className="text-muted font-normal">(optional)</span>
          </label>
          <input
            id="br-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#a3e635]/50"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-full bg-[#a3e635] py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Creating..." : "Create Buddy Read"}
      </button>
    </form>
  );
}
