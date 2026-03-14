"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ReadingStateButton } from "@/components/reading-state-button";
import { OwnedButton } from "@/components/owned-button";
import { FormatButton } from "@/components/format-button";

import type { EditionSelection } from "@/app/book/[id]/book-page-client";

interface ReadingStateSelectorProps {
  bookId: string;
  currentState: string | null;
  ownedFormats: string[];
  activeFormats: string[];
  isLoggedIn: boolean;
  openLibraryKey?: string | null;
  existingEditionSelections?: EditionSelection[];
  onStateChange?: (state: string | null) => void;
  onActiveFormatsChange?: (formats: string[]) => void;
  onEditionSelectionsChange?: (selections: EditionSelection[]) => void;
}

export function ReadingStateSelector({
  bookId,
  currentState,
  ownedFormats,
  activeFormats,
  isLoggedIn,
  openLibraryKey,
  existingEditionSelections = [],
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
          className="block w-full rounded-xl bg-primary py-3 text-center text-base font-semibold text-background shadow-[0_0_20px_rgba(163,230,53,0.25)] hover:shadow-[0_0_28px_rgba(163,230,53,0.4)] transition-all"
        >
          Sign in to track
        </Link>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface-alt border border-border py-3 px-5 text-center text-sm font-semibold text-muted/50">
            Format
          </div>
          <div className="rounded-xl bg-surface-alt border border-border py-3 px-5 text-center text-sm font-semibold text-muted">
            Owned
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <ReadingStateButton
        bookId={bookId}
        currentState={currentState}
        isLoggedIn={isLoggedIn}
        onStateChange={handleStateChange}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormatButton
          bookId={bookId}
          activeFormats={activeFormats}
          isCurrentlyReading={formatEnabled}
          isLoggedIn={isLoggedIn}
          forceOpen={promptFormat}
          onForceOpenHandled={handleForceOpenHandled}
          onFormatsChange={onActiveFormatsChange}
        />
        <OwnedButton
          bookId={bookId}
          currentFormats={ownedFormats}
          isLoggedIn={isLoggedIn}
          openLibraryKey={openLibraryKey}
          existingEditionSelections={existingEditionSelections}
          onEditionSelectionsChange={onEditionSelectionsChange}
        />
      </div>
    </div>
  );
}
