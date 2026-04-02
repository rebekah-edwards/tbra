"use client";

import Image from "next/image";
import Link from "next/link";
import { ReadingStateButton } from "@/components/reading-state-button";
import { CompactOwnedButton } from "@/components/compact-owned-button";
import { StarRow } from "@/components/review/rounded-star";
import { useState, useMemo } from "react";
import { NoCover } from "@/components/no-cover";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { toggleSeriesCoverStyle, setSeriesCover } from "@/lib/actions/series";

interface SeriesBook {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  openLibraryKey: string | null;
  position: number | null;
  publicationYear: number | null;
  authors: string[];
  userRating: number | null;
  currentState: string | null;
  ownedFormats: string[];
  isBoxSet: boolean;
}

interface SeriesBooksViewProps {
  seriesName: string;
  seriesId?: string;
  books: SeriesBook[];
  isLoggedIn: boolean;
  isAdmin?: boolean;
  canReport?: boolean;
  coverStyle?: string;
}

type FilterTab = "core" | "all" | "sets";

const TABS: { key: FilterTab; label: string }[] = [
  { key: "core", label: "Core" },
  { key: "all", label: "All" },
  { key: "sets", label: "Sets" },
];

export function SeriesBooksView({ seriesName, seriesId, books, isLoggedIn, isAdmin = false, canReport = false, coverStyle: initialCoverStyle = "default" }: SeriesBooksViewProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("core");
  const [coverStyle, setCoverStyle] = useState(initialCoverStyle);
  const [isTogglingCover, setIsTogglingCover] = useState(false);
  const [editingCover, setEditingCover] = useState<{ bookId: string; olKey: string | null; title: string } | null>(null);
  const [editionCovers, setEditionCovers] = useState<{ coverId: number; title: string; format?: string; year?: string }[]>([]);
  const [loadingCovers, setLoadingCovers] = useState(false);
  const [savingCover, setSavingCover] = useState(false);
  const [bookStates, setBookStates] = useState<Record<string, string | null>>(
    () => Object.fromEntries(books.map((b) => [b.id, b.currentState]))
  );
  const [bookOwnedFormats, setBookOwnedFormats] = useState<Record<string, string[]>>(
    () => Object.fromEntries(books.map((b) => [b.id, b.ownedFormats]))
  );

  const filteredBooks = useMemo(() => {
    switch (activeTab) {
      case "core":
        // Integer positions only — no .5 novellas, no null position, no box sets
        return books.filter(
          (b) =>
            !b.isBoxSet &&
            b.position != null &&
            Number.isInteger(b.position)
        );
      case "all":
        // Everything except box sets
        return books.filter((b) => !b.isBoxSet);
      case "sets":
        // Only box sets
        return books.filter((b) => b.isBoxSet);
    }
  }, [activeTab, books]);

  // Count for each tab
  const counts = useMemo(() => ({
    core: books.filter((b) => !b.isBoxSet && b.position != null && Number.isInteger(b.position)).length,
    all: books.filter((b) => !b.isBoxSet).length,
    sets: books.filter((b) => b.isBoxSet).length,
  }), [books]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">{seriesName}</h1>
        {seriesId && (
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={async () => {
                  setIsTogglingCover(true);
                  const result = await toggleSeriesCoverStyle(seriesId);
                  if (result.success) setCoverStyle(result.coverStyle);
                  setIsTogglingCover(false);
                }}
                disabled={isTogglingCover}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  coverStyle === "format"
                    ? "bg-neon-blue/20 text-neon-blue border border-neon-blue/40"
                    : "bg-surface-alt text-muted border border-border hover:text-foreground"
                } ${isTogglingCover ? "opacity-50" : ""}`}
                title={coverStyle === "format" ? "Covers: showing user format editions" : "Covers: showing default editions"}
              >
                {coverStyle === "format" ? "Covers: Format" : "Covers: Default"}
              </button>
            )}

          </div>
        )}
      </div>

      {/* Segmented control */}
      <div className="mt-4 flex gap-1 rounded-xl bg-surface-alt p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-accent text-black shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {counts[tab.key] > 0 && (
              <span className={`ml-1.5 text-xs ${activeTab === tab.key ? "opacity-80" : "opacity-60"}`}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* SEO: associate tab content with H2 headings */}
      <h2 className="sr-only">
        {activeTab === "core" && "Core Books"}
        {activeTab === "all" && "All Books"}
        {activeTab === "sets" && "Box Sets"}
      </h2>

      <p className="mt-3 text-muted text-xs">
        {activeTab === "core" && "Main series novels"}
        {activeTab === "all" && "All entries including novellas"}
        {activeTab === "sets" && "Box sets and collections"}
      </p>

      <div className="mt-4 space-y-3">
        {filteredBooks.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            {activeTab === "sets" ? "No box sets found" : "No books found"}
          </p>
        )}
        {filteredBooks.map((book) => (
          <div
            key={book.id}
            className="flex gap-4 rounded-lg border border-border bg-surface p-4"
          >
            <div className="relative flex-shrink-0">
              <Link href={`/book/${book.slug || book.id}`}>
                {book.coverImageUrl ? (
                  <Image
                    src={book.coverImageUrl}
                    alt={`Cover of ${book.title}`}
                    width={60}
                    height={90}
                    className="h-[90px] w-[60px] rounded object-cover hover:opacity-80 transition-opacity"
                  />
                ) : (
                  <NoCover title={book.title} className="h-[90px] w-[60px]" size="sm" />
                )}
              </Link>
              {isAdmin && (
                <button
                  onClick={async () => {
                    setEditingCover({ bookId: book.id, olKey: book.openLibraryKey ?? null, title: book.title });
                    setEditionCovers([]);
                    if (book.openLibraryKey) {
                      setLoadingCovers(true);
                      try {
                        const res = await fetch(`/api/openlibrary/editions?workKey=${encodeURIComponent(book.openLibraryKey)}&limit=100`);
                        if (res.ok) {
                          const data = await res.json();
                          const covers: { coverId: number; title: string; format?: string; year?: string }[] = [];
                          const seenIds = new Set<number>();
                          for (const ed of data.entries) {
                            if (ed.covers) {
                              for (const cid of ed.covers) {
                                if (cid > 0 && !seenIds.has(cid)) {
                                  seenIds.add(cid);
                                  covers.push({
                                    coverId: cid,
                                    title: ed.title,
                                    format: ed.physical_format,
                                    year: ed.publish_date,
                                  });
                                }
                              }
                            }
                          }
                          setEditionCovers(covers);
                        }
                      } catch { /* ignore */ }
                      setLoadingCovers(false);
                    }
                  }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center text-muted hover:text-foreground transition-colors"
                  title="Set series cover"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex flex-1 flex-col justify-between">
              <div>
                <Link href={`/book/${book.slug || book.id}`}>
                  <h3 className="font-medium leading-tight hover:text-link transition-colors">
                    {book.title}
                  </h3>
                </Link>
                {(book.position != null || book.publicationYear) && (
                  <p className="text-xs text-muted">
                    {[
                      book.position != null
                        ? Number.isInteger(book.position) ? `Book ${book.position}` : `Novella ${book.position}`
                        : null,
                      book.publicationYear,
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
                {book.authors.length > 0 && (
                  <p className="mt-0.5 text-sm text-muted">
                    {book.authors.join(", ")}
                  </p>
                )}
                {book.userRating != null && book.userRating > 0 && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <StarRow rating={book.userRating} size={14} />
                    <span className="text-xs font-medium text-foreground/70">
                      {book.userRating % 0.25 === 0 && book.userRating % 0.5 !== 0
                        ? book.userRating.toFixed(2)
                        : book.userRating.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <ReadingStateButton
                  bookId={book.id}
                  currentState={bookStates[book.id] ?? null}
                  isLoggedIn={isLoggedIn}
                  compact
                  onStateChange={(newState) => {
                    setBookStates((prev) => ({ ...prev, [book.id]: newState }));
                  }}
                />
                <CompactOwnedButton
                  bookId={book.id}
                  currentFormats={bookOwnedFormats[book.id] ?? []}
                  isLoggedIn={isLoggedIn}
                  onFormatsChange={(formats) => {
                    setBookOwnedFormats((prev) => ({ ...prev, [book.id]: formats }));
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {editingCover && (
        <BottomSheet
          open={!!editingCover}
          onClose={() => setEditingCover(null)}
          title={`Cover for "${editingCover.title}"`}
        >
          <div className="px-1 pb-4">
            {loadingCovers && (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-muted/30 border-t-foreground rounded-full animate-spin" />
              </div>
            )}
            {!loadingCovers && editionCovers.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">No edition covers found</p>
            )}
            {!loadingCovers && editionCovers.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {editionCovers.map((ec) => (
                  <button
                    key={ec.coverId}
                    onClick={async () => {
                      setSavingCover(true);
                      const url = `https://covers.openlibrary.org/b/id/${ec.coverId}-L.jpg`;
                      await setSeriesCover(editingCover.bookId, url);
                      setSavingCover(false);
                      setEditingCover(null);
                    }}
                    disabled={savingCover}
                    className="flex flex-col items-center gap-1 rounded-lg p-1.5 hover:bg-surface-alt transition-colors disabled:opacity-50"
                  >
                    <img
                      src={`https://covers.openlibrary.org/b/id/${ec.coverId}-M.jpg`}
                      alt={ec.title}
                      className="w-full aspect-[2/3] rounded-md object-cover border border-border"
                      loading="lazy"
                    />
                    <span className="text-[10px] text-muted leading-tight text-center line-clamp-2">
                      {[ec.format, ec.year].filter(Boolean).join(" · ") || ec.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={async () => {
                setSavingCover(true);
                await setSeriesCover(editingCover.bookId, null);
                setSavingCover(false);
                setEditingCover(null);
              }}
              disabled={savingCover}
              className="mt-4 w-full rounded-xl bg-surface-alt text-muted py-2.5 text-sm font-medium hover:text-foreground transition-colors disabled:opacity-50"
            >
              Reset to Default
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
