"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookHeader } from "@/components/book/book-header";
import { ReadingStateSelector } from "@/components/book/reading-state-selector";

import { BuyButton } from "@/components/book/buy-button";
import { ReviewTrigger } from "@/components/review/review-trigger";
import { PostCompletionSuggestions } from "@/components/book/post-completion-suggestions";
import { getEffectiveCoverUrl } from "@/lib/covers";
import { autoLinkFormatEdition } from "@/lib/actions/editions";
import { setBookCover, uploadBookCover } from "@/lib/actions/books";
import { setBookState } from "@/lib/actions/reading-state";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Confetti } from "@/components/ui/confetti";
import { ContentWarningBanner } from "@/components/book/content-warning-banner";
import { BookSummary } from "@/components/book/book-summary";
import { ReportIssueButton } from "@/components/book/report-issue-button";
import type { UserReview } from "@/lib/queries/review";

export type EditionSelection = {
  editionId: string;
  format: string;
  openLibraryKey: string;
  coverId: number | null;
};

interface BookPageClientProps {
  shelfButton?: React.ReactNode;
  book: {
    id: string;
    title: string;
    coverImageUrl: string | null;
    authors: { id: string; name: string; slug?: string | null; role: string }[];
    genres: string[];
    publicationYear: number | null;
    pages: number | null;
    audioLengthMinutes: number | null;
    openLibraryKey: string | null;
    isFiction: boolean | null;
    topLevelGenre: string | null;
    ageCategory: string | null;
    description: string | null;
    summary?: string | null;
    isbn13?: string | null;
    asin?: string | null;
    pacing?: string | null;
    seriesName?: string | null;
    seriesSlug?: string | null;
    seriesId?: string | null;
    positionInSeries?: number | null;
  };
  userState: {
    state: string | null;
    ownedFormats: string[];
    activeFormats: string[];
  };
  isLoggedIn: boolean;
  isAdmin?: boolean;
  editionSelections: EditionSelection[];
  userReview: UserReview | null;
  aggregate: { average: number; count: number } | null;
  hasCompletedSession: boolean;
  lastReadFormat: string | null;
  lastReadDate: string | null;
  lastReadPrecision: string | null;
  upNextPosition: number | null;
  upNextCount: number;
  isFavorited: boolean;
  isRecentlyImported?: boolean;
  isHidden?: boolean;
  canReport?: boolean;
  contentConflicts?: { categoryName: string; bookIntensity: number; userMax: number }[];
  isPremium?: boolean;
  initialTbrNote?: string | null;
  prePublication?: boolean;
}

function formatReadDate(dateStr: string, precision: string | null): string {
  const date = new Date(dateStr);
  if (precision === "year") return `${date.getFullYear()}`;
  if (precision === "month") {
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  // Default: month + year for "day" precision too (cleaner display)
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function BookPageClient({
  shelfButton,
  book,
  userState,
  isLoggedIn,
  editionSelections: initialEditionSelections,
  userReview,
  aggregate,
  hasCompletedSession: initialHasCompleted,
  lastReadFormat,
  lastReadDate,
  lastReadPrecision,
  upNextPosition,
  upNextCount,
  isFavorited,
  isRecentlyImported = false,
  isAdmin = false,
  isHidden: initialIsHidden = false,
  canReport = false,
  contentConflicts = [],
  isPremium: userIsPremium = false,
  initialTbrNote = null,
  prePublication = false,
}: BookPageClientProps) {
  const [currentState, setCurrentState] = useState(userState.state);
  const [activeFormats, setActiveFormats] = useState(userState.activeFormats);
  const [editionSelections, setEditionSelections] = useState(initialEditionSelections);
  const [autoOpenReview, setAutoOpenReview] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(initialHasCompleted);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showEnrichmentBanner, setShowEnrichmentBanner] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [editingCover, setEditingCover] = useState(false);
  const [editionCovers, setEditionCovers] = useState<{ coverId: number; title: string; format?: string; year?: string }[]>([]);
  const [loadingCovers, setLoadingCovers] = useState(false);
  const [savingCover, setSavingCover] = useState(false);
  const [baseCoverUrl, setBaseCoverUrl] = useState(book.coverImageUrl);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pollCountRef = useRef(0);
  const coverFileRef = useRef<HTMLInputElement>(null);

  // Show enrichment overlay only after hydration (avoids SSR mismatch)
  useEffect(() => {
    setMounted(true);
    if (isRecentlyImported) setShowEnrichmentBanner(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-trigger completion flow when navigated from homepage with ?complete=true
  // This passes through to ReadingStateButton's autoComplete prop, which opens the
  // date picker first (same flow as tapping "Finished" on the book page itself)
  const autoComplete = searchParams.get("complete") === "true" && currentState === "currently_reading";
  const autoCompleteCleanedUp = useRef(false);
  useEffect(() => {
    if (autoComplete && !autoCompleteCleanedUp.current) {
      autoCompleteCleanedUp.current = true;
      router.replace(`/book/${book.slug || book.id}`, { scroll: false });
    }
  }, [autoComplete, book.slug, book.id, router]);

  // Client-side fallback: trigger enrichment if server-side after() didn't fire
  useEffect(() => {
    if (!isRecentlyImported) return;
    fetch("/api/enrichment/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: book.id }),
    }).catch(() => {
      // Best-effort — server-side after() is the primary mechanism
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss banner after 8 seconds (details arrive via background enrichment, not instant)
  useEffect(() => {
    if (!showEnrichmentBanner) return;
    const timeout = setTimeout(() => {
      setShowEnrichmentBanner(false);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [showEnrichmentBanner]);

  // Hide banner when enrichment data arrives (prop changes on refresh)
  useEffect(() => {
    if (!isRecentlyImported && showEnrichmentBanner) {
      setShowEnrichmentBanner(false);
    }
  }, [isRecentlyImported, showEnrichmentBanner]);

  const isActivelyReading = currentState === "currently_reading" || currentState === "paused";

  // Determine effective formats for display (active when reading, owned otherwise)
  const effectiveFormats = activeFormats.length > 0 && isActivelyReading
    ? activeFormats
    : userState.ownedFormats;
  const showAudioLength =
    effectiveFormats.length === 1 && effectiveFormats[0] === "audiobook";

  // Cover cascade using shared utility
  const effectiveCoverUrl = useMemo(() => {
    return getEffectiveCoverUrl({
      baseCoverUrl,
      editionSelections: editionSelections.map((e) => ({ format: e.format, coverId: e.coverId })),
      activeFormats,
      ownedFormats: userState.ownedFormats,
      isActivelyReading,
      size: "L",
    });
  }, [editionSelections, activeFormats, isActivelyReading, userState.ownedFormats, baseCoverUrl]);

  // When formats change, auto-link editions for any format that doesn't have one yet
  const handleActiveFormatsChange = useCallback(
    async (newFormats: string[]) => {
      setActiveFormats(newFormats);

      // For each newly selected format, check if we need to auto-link an edition
      for (const fmt of newFormats) {
        const hasEdition = editionSelections.some(
          (e) => e.format === fmt && e.coverId
        );
        if (hasEdition) continue;

        // Auto-link in the background
        const result = await autoLinkFormatEdition(book.id, fmt);
        if (result) {
          setEditionSelections((prev) => {
            // Avoid duplicates
            if (prev.some((e) => e.editionId === result.editionId && e.format === result.format)) {
              return prev;
            }
            return [...prev, result];
          });
        }
      }
    },
    [editionSelections, book.id]
  );

  const handleStateChange = useCallback((newState: string | null) => {
    setCurrentState(newState);
    // Clear active formats when leaving reading states
    if (newState !== "currently_reading" && newState !== "paused") {
      setActiveFormats([]);
    }
    // Optimistically mark as completed for review gate
    if (newState === "completed" || newState === "dnf") {
      setHasCompleted(true);
    }
    // Auto-open review wizard when marking as completed
    if (newState === "completed" && !userReview) {
      setAutoOpenReview(true);
    }
    // Show post-completion suggestions and celebration
    if (newState === "completed") {
      setShowConfetti(true);
      // Small delay so review wizard opens first
      setTimeout(() => setShowSuggestions(true), 500);
    }
  }, [userReview]);

  return (
    <>
      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}
      {mounted && showEnrichmentBanner && (
        <div className="relative z-10 mx-auto lg:max-w-[60%] mb-4">
          <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-surface/90 backdrop-blur-md px-4 py-3">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin shrink-0" />
            <p className="text-xs text-muted">
              Additional details for this book are on the way. What you see below is everything we have so far.
            </p>
          </div>
        </div>
      )}

      {/* Book header — full width, desktop uses flex so both sides contribute to height */}
      <div className="relative isolate lg:flex lg:items-start lg:gap-4">
        <BookHeader
            title={book.title}
            coverImageUrl={effectiveCoverUrl}
            authors={book.authors}
            genres={book.genres}
            publicationYear={book.publicationYear}
            pages={book.pages}
            audioLengthMinutes={book.audioLengthMinutes}
            showAudioLength={showAudioLength}
            isManuallyAdded={!book.openLibraryKey && !book.description && book.genres.length === 0}
            topLevelGenre={book.topLevelGenre}
            ageCategory={book.ageCategory}
            pacing={book.pacing}
            seriesName={book.seriesName}
            seriesSlug={book.seriesSlug}
            seriesId={book.seriesId}
            positionInSeries={book.positionInSeries}
            onCoverEditClick={isAdmin ? async () => {
              setEditingCover(true);
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
            } : undefined}
          />

        {/* Desktop: actions panel — flows in flex layout so taller content pushes page down */}
        <div className="hidden lg:block lg:flex-1 lg:pl-6">
          <div className="space-y-4">
            {/* Summary above buttons, left-justified */}
            {book.summary && (
              <BookSummary summary={book.summary} variant="frosted" layout="desktop" />
            )}
            <ReadingStateSelector
              bookId={book.id}
              bookTitle={book.title}
              currentState={currentState}
              ownedFormats={userState.ownedFormats}
              activeFormats={activeFormats}
              isLoggedIn={isLoggedIn}
              openLibraryKey={book.openLibraryKey}
              existingEditionSelections={editionSelections}
              upNextPosition={upNextPosition}
              upNextCount={upNextCount}
              isFavorited={isFavorited}
              isbn13={book.isbn13}
              asin={book.asin}
              shelfButton={shelfButton}
              isPremium={userIsPremium}
              initialTbrNote={initialTbrNote}
              autoComplete={autoComplete}
              onStateChange={handleStateChange}
              onActiveFormatsChange={handleActiveFormatsChange}
              onEditionSelectionsChange={setEditionSelections}
            />
            {/* Rating + review info */}
            <div className="space-y-1 lg:pt-2.5">
              {aggregate && aggregate.count > 0 ? (
                <div className="flex items-center gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <svg key={i} width="18" height="18" viewBox="0 0 24 24" fill={i < Math.round(aggregate.average) ? "#facc15" : "none"} stroke="#facc15" strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ))}
                  <span className="text-sm text-foreground/70">{aggregate.average.toFixed(1)} avg.</span>
                  <span className="text-sm text-foreground/50">·</span>
                  <a href={`/book/${book.id}/reviews`} className="text-sm text-neon-blue underline hover:text-neon-blue/80">{aggregate.count} {aggregate.count === 1 ? "review" : "reviews"}</a>
                </div>
              ) : (
                <p className="text-sm text-muted/60">No reviews yet</p>
              )}
              {userReview ? (
                <button type="button" onClick={() => setAutoOpenReview(true)} className="text-sm text-primary hover:text-primary/80 font-medium">
                  Edit your review
                </button>
              ) : currentState === "completed" || currentState === "dnf" ? (
                <button type="button" onClick={() => setAutoOpenReview(true)} className="text-sm text-neon-blue hover:text-neon-blue/80 font-medium">
                  Leave a review
                </button>
              ) : isLoggedIn && !userReview && aggregate && aggregate.count > 0 ? (
                <span className="text-sm text-muted/60">Finish reading to leave a review</span>
              ) : null}
            </div>
            {contentConflicts.length > 0 && (
              <ContentWarningBanner conflicts={contentConflicts} />
            )}
          </div>
        </div>
      </div>

      {/* Mobile: actions below header */}
      <div className="mt-7 lg:hidden">
        <ReadingStateSelector
          bookId={book.id}
          bookTitle={book.title}
          currentState={currentState}
          ownedFormats={userState.ownedFormats}
          activeFormats={activeFormats}
          isLoggedIn={isLoggedIn}
          openLibraryKey={book.openLibraryKey}
          existingEditionSelections={editionSelections}
          upNextPosition={upNextPosition}
          upNextCount={upNextCount}
          isFavorited={isFavorited}
          isbn13={book.isbn13}
          asin={book.asin}
          shelfButton={shelfButton}
          isPremium={userIsPremium}
          initialTbrNote={initialTbrNote}
          autoComplete={autoComplete}
          onStateChange={handleStateChange}
          onActiveFormatsChange={handleActiveFormatsChange}
          onEditionSelectionsChange={setEditionSelections}
        />
      </div>

      {lastReadFormat && lastReadDate && (currentState === "completed" || currentState === "dnf" || currentState === "to_read" || !currentState) && (
        <p className="mt-1 text-center text-xs text-muted">
          Last read via {lastReadFormat === "ebook" ? "eBook" : lastReadFormat === "audiobook" ? "audiobook" : lastReadFormat}{" "}
          in {formatReadDate(lastReadDate, lastReadPrecision)}
        </p>
      )}

      {/* Hide rating display on desktop (shown in right panel), but keep review dialog functional */}
      <div className="lg:[&>div:first-child]:hidden">
        <ReviewTrigger
          bookId={book.id}
          bookPages={book.pages}
          userReview={userReview}
          aggregate={aggregate}
          isLoggedIn={isLoggedIn}
          autoOpen={autoOpenReview}
          hasCompletedSession={hasCompleted}
          prePublication={prePublication}
        />
      </div>

      {isLoggedIn && (
        <PostCompletionSuggestions
          bookId={book.id}
          show={showSuggestions}
          onDismiss={() => setShowSuggestions(false)}
        />
      )}

      {editingCover && (
        <BottomSheet
          open={editingCover}
          onClose={() => setEditingCover(false)}
          title={`Cover for "${book.title}"`}
        >
          <div className="px-1 pb-4">
            {/* Upload file */}
            <div className="mb-4">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-2">
                Upload Cover
              </label>
              <input
                ref={coverFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setSavingCover(true);
                  try {
                    const formData = new FormData();
                    formData.append("cover", file);
                    const result = await uploadBookCover(book.id, formData);
                    if (result.success && result.url) setBaseCoverUrl(result.url);
                  } catch (err) {
                    console.error("Failed to upload cover:", err);
                  } finally {
                    setSavingCover(false);
                    setEditingCover(false);
                    if (coverFileRef.current) coverFileRef.current.value = "";
                  }
                }}
                disabled={savingCover}
                className="w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary/15 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/25 file:cursor-pointer"
              />
              <p className="mt-1 text-[10px] text-muted">JPG, PNG, or WebP. Max 2MB.</p>
            </div>

            {/* Paste URL */}
            <div className="mb-4">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-2">
                Paste Cover URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://..."
                  id="header-cover-url-input"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
                <button
                  onClick={async () => {
                    const input = document.getElementById("header-cover-url-input") as HTMLInputElement;
                    const url = input?.value?.trim();
                    if (!url) return;
                    setSavingCover(true);
                    const result = await setBookCover(book.id, url);
                    if (!result.success) {
                      alert(result.error || "Failed to set cover");
                      setSavingCover(false);
                      return;
                    }
                    setBaseCoverUrl(url);
                    setSavingCover(false);
                    setEditingCover(false);
                  }}
                  disabled={savingCover}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
                >
                  Set
                </button>
              </div>
            </div>

            {/* OL edition covers */}
            {loadingCovers && (
              <div className="flex items-center justify-center py-6">
                <div className="w-6 h-6 border-2 border-muted/30 border-t-foreground rounded-full animate-spin" />
              </div>
            )}
            {!loadingCovers && editionCovers.length > 0 && (
              <>
                <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-2">
                  Open Library Editions ({editionCovers.length})
                </label>
                <div className="grid grid-cols-4 gap-2 max-h-[300px] overflow-y-auto">
                  {editionCovers.map((ec) => (
                    <button
                      key={ec.coverId}
                      onClick={async () => {
                        setSavingCover(true);
                        try {
                          const url = `https://covers.openlibrary.org/b/id/${ec.coverId}-L.jpg`;
                          const result = await setBookCover(book.id, url);
                          if (result.success) {
                            setBaseCoverUrl(url);
                          } else {
                            alert(result.error || "Failed to set cover");
                          }
                        } catch (err) {
                          console.error("Failed to set cover:", err);
                          alert("Failed to set cover. Please try again.");
                        } finally {
                          setSavingCover(false);
                          setEditingCover(false);
                        }
                      }}
                      disabled={savingCover}
                      className="flex flex-col items-center gap-0.5 rounded-lg p-1 hover:bg-surface-alt transition-colors disabled:opacity-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://covers.openlibrary.org/b/id/${ec.coverId}-M.jpg`}
                        alt={ec.title}
                        className="w-full aspect-[2/3] rounded object-cover border border-border"
                        loading="lazy"
                      />
                      <span className="text-[9px] text-muted leading-tight text-center line-clamp-1">
                        {[ec.format, ec.year].filter(Boolean).join(" · ") || ec.title}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {!loadingCovers && editionCovers.length === 0 && !book.openLibraryKey && (
              <p className="py-4 text-center text-xs text-muted">No Open Library editions available</p>
            )}

            {/* Remove cover */}
            <button
              onClick={async () => {
                setSavingCover(true);
                try {
                  const result = await setBookCover(book.id, null);
                  if (result.success) setBaseCoverUrl(null);
                } catch (err) {
                  console.error("Failed to remove cover:", err);
                } finally {
                  setSavingCover(false);
                  setEditingCover(false);
                }
              }}
              disabled={savingCover}
              className="mt-4 w-full rounded-xl bg-surface-alt text-muted py-2.5 text-sm font-medium hover:text-foreground transition-colors disabled:opacity-50"
            >
              Remove Cover
            </button>
          </div>
        </BottomSheet>
      )}

    </>
  );
}
