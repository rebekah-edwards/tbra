"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ReadingStateButton } from "@/components/reading-state-button";
import { OwnedButton } from "@/components/owned-button";
import { FormatButton } from "@/components/format-button";
import { UpNextButton } from "@/components/book/up-next-button";
import { BuyButton } from "@/components/book/buy-button";

import type { EditionSelection } from "@/app/book/[id]/book-page-client";

interface ReadingStateSelectorProps {
  bookId: string;
  bookTitle: string;
  currentState: string | null;
  ownedFormats: string[];
  activeFormats: string[];
  isLoggedIn: boolean;
  openLibraryKey?: string | null;
  existingEditionSelections?: EditionSelection[];
  upNextPosition?: number | null;
  upNextCount?: number;
  isFavorited?: boolean;
  isbn13?: string | null;
  asin?: string | null;
  /** Slot for the AddToShelfButton rendered below the action grid */
  shelfButton?: React.ReactNode;
  isPremium?: boolean;
  initialTbrNote?: string | null;
  autoComplete?: boolean;
  onStateChange?: (state: string | null) => void;
  onActiveFormatsChange?: (formats: string[]) => void;
  onEditionSelectionsChange?: (selections: EditionSelection[]) => void;
}

export function ReadingStateSelector({
  bookId,
  bookTitle,
  currentState,
  ownedFormats,
  activeFormats,
  isLoggedIn,
  openLibraryKey,
  existingEditionSelections = [],
  upNextPosition = null,
  upNextCount = 0,
  isFavorited = false,
  isbn13,
  asin,
  shelfButton,
  isPremium = false,
  initialTbrNote = null,
  autoComplete = false,
  onStateChange,
  onActiveFormatsChange,
  onEditionSelectionsChange,
}: ReadingStateSelectorProps) {
  // Format button enabled for any active reading state (not just currently_reading)
  const formatEnabled = !!currentState;
  const [promptFormat, setPromptFormat] = useState(false);

  const handleStateChange = useCallback((newState: string | null) => {
    onStateChange?.(newState);
    if (newState === "currently_reading") {
      setPromptFormat(true);
    }
  }, [onStateChange]);

  const handleForceOpenHandled = useCallback(() => {
    setPromptFormat(false);
  }, []);

  if (!isLoggedIn) {
    return (
      <div className="mt-6 space-y-3">
        <Link
          href="/login"
          className="block w-full rounded-xl bg-accent py-3 text-center text-base font-semibold text-black shadow-[0_0_20px_rgba(163,230,53,0.25)] hover:shadow-[0_0_28px_rgba(163,230,53,0.4)] transition-all"
        >
          Sign in to track
        </Link>
        <div className="rounded-xl bg-neon-purple/10 border-2 border-neon-purple/20 py-3 px-3 text-center text-sm font-semibold text-muted/50">
          Owned
        </div>
      </div>
    );
  }

  const showUpNext = currentState === "tbr";
  const showFormat = currentState === "currently_reading" || currentState === "paused";

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-2">
        {showUpNext && (
          <UpNextButton
            bookId={bookId}
            position={upNextPosition ?? null}
            queueCount={upNextCount}
          />
        )}
        <div className="flex-1">
          <ReadingStateButton
            bookId={bookId}
            currentState={currentState}
            isLoggedIn={isLoggedIn}
            isPremium={isPremium}
            initialTbrNote={initialTbrNote}
            autoComplete={autoComplete}
            onStateChange={handleStateChange}
          />
        </div>
        <BuyButton bookTitle={bookTitle} isbn13={isbn13} asin={asin} />
      </div>
      <div className={`grid gap-3 ${showFormat ? "grid-cols-3" : "grid-cols-2"}`}>
        {showFormat && (
          <FormatButton
            bookId={bookId}
            activeFormats={activeFormats}
            isCurrentlyReading={true}
            isLoggedIn={isLoggedIn}
            forceOpen={promptFormat}
            onForceOpenHandled={handleForceOpenHandled}
            onFormatsChange={onActiveFormatsChange}
          />
        )}
        <OwnedButton
          bookId={bookId}
          currentFormats={ownedFormats}
          isLoggedIn={isLoggedIn}
          openLibraryKey={openLibraryKey}
          existingEditionSelections={existingEditionSelections}
          onEditionSelectionsChange={onEditionSelectionsChange}
        />
        {shelfButton}
      </div>
    </div>
  );
}
