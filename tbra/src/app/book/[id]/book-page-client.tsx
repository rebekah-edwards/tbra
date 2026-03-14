"use client";

import { useState, useMemo, useCallback } from "react";
import { BookHeader } from "@/components/book/book-header";
import { ReadingStateSelector } from "@/components/book/reading-state-selector";
import { ReviewTrigger } from "@/components/review/review-trigger";
import { buildCoverUrl } from "@/lib/openlibrary";
import type { UserReview } from "@/lib/queries/review";

export type EditionSelection = {
  editionId: string;
  format: string;
  openLibraryKey: string;
  coverId: number | null;
};

interface BookPageClientProps {
  book: {
    id: string;
    title: string;
    coverImageUrl: string | null;
    authors: { id: string; name: string; role: string }[];
    genres: string[];
    publicationYear: number | null;
    pages: number | null;
    audioLengthMinutes: number | null;
    openLibraryKey: string | null;
    isFiction: boolean | null;
  };
  userState: {
    state: string | null;
    ownedFormats: string[];
    activeFormats: string[];
  };
  isLoggedIn: boolean;
  editionSelections: EditionSelection[];
  userReview: UserReview | null;
  aggregate: { average: number; count: number } | null;
}

export function BookPageClient({
  book,
  userState,
  isLoggedIn,
  editionSelections: initialEditionSelections,
  userReview,
  aggregate,
}: BookPageClientProps) {
  const [currentState, setCurrentState] = useState(userState.state);
  const [activeFormats, setActiveFormats] = useState(userState.activeFormats);
  const [editionSelections, setEditionSelections] = useState(initialEditionSelections);
  const [autoOpenReview, setAutoOpenReview] = useState(false);

  const isActivelyReading = currentState === "currently_reading" || currentState === "paused";

  // Determine effective formats for display (active when reading, owned otherwise)
  const effectiveFormats = activeFormats.length > 0 && isActivelyReading
    ? activeFormats
    : userState.ownedFormats;
  const showAudioLength =
    effectiveFormats.length === 1 && effectiveFormats[0] === "audiobook";

  // Cover cascade:
  // 1. Active format edition (only when currently_reading or paused)
  // 2. First owned format edition with a cover
  // 3. Work-level cover
  const effectiveCoverUrl = useMemo(() => {
    if (editionSelections.length === 0) return book.coverImageUrl;

    // 1. Active format override (only during currently_reading / paused)
    if (isActivelyReading && activeFormats.length > 0) {
      for (const fmt of activeFormats) {
        const match = editionSelections.find(
          (e) => e.format === fmt && e.coverId
        );
        if (match) return buildCoverUrl(match.coverId, "L") ?? book.coverImageUrl;
      }
    }

    // 2. Owned format editions — prefer first owned format that has an edition with a cover
    for (const fmt of userState.ownedFormats) {
      const match = editionSelections.find(
        (e) => e.format === fmt && e.coverId
      );
      if (match) return buildCoverUrl(match.coverId, "L") ?? book.coverImageUrl;
    }

    // 3. Any edition with a cover
    const withCover = editionSelections.find((e) => e.coverId);
    if (withCover) return buildCoverUrl(withCover.coverId, "L") ?? book.coverImageUrl;

    return book.coverImageUrl;
  }, [editionSelections, activeFormats, isActivelyReading, userState.ownedFormats, book.coverImageUrl]);

  const handleStateChange = useCallback((newState: string | null) => {
    setCurrentState(newState);
    // Clear active formats when leaving reading states
    if (newState !== "currently_reading" && newState !== "paused") {
      setActiveFormats([]);
    }
    // Auto-open review wizard when marking as completed
    if (newState === "completed" && !userReview) {
      setAutoOpenReview(true);
    }
  }, [userReview]);

  return (
    <>
      <BookHeader
        title={book.title}
        coverImageUrl={effectiveCoverUrl}
        authors={book.authors}
        genres={book.genres}
        publicationYear={book.publicationYear}
        pages={book.pages}
        audioLengthMinutes={book.audioLengthMinutes}
        showAudioLength={showAudioLength}
        isManuallyAdded={!book.openLibraryKey}
        isFiction={book.isFiction}
      />

      <ReadingStateSelector
        bookId={book.id}
        currentState={currentState}
        ownedFormats={userState.ownedFormats}
        activeFormats={activeFormats}
        isLoggedIn={isLoggedIn}
        openLibraryKey={book.openLibraryKey}
        existingEditionSelections={editionSelections}
        onStateChange={handleStateChange}
        onActiveFormatsChange={setActiveFormats}
        onEditionSelectionsChange={setEditionSelections}
      />

      <ReviewTrigger
        bookId={book.id}
        userReview={userReview}
        aggregate={aggregate}
        isLoggedIn={isLoggedIn}
        autoOpen={autoOpenReview}
      />
    </>
  );
}
