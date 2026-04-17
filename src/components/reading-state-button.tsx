"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { setBookState, removeBookState, setBookStateWithImport, removeFromLibrary, type ExternalBookImportInput } from "@/lib/actions/reading-state";
import { setBookStateWithCompletion } from "@/lib/actions/reading-session";
import { CompletionDatePicker } from "@/components/book/completion-date-picker";
import { TbrNoteEditor } from "@/components/book/tbr-note-editor";
import type { OLSearchResult } from "@/lib/openlibrary";

const STATE_TOAST_MESSAGES: Record<string, string> = {
  tbr: "Added to TBR",
  currently_reading: "Marked as Reading Now",
  completed: "Marked as Finished",
  paused: "Marked as Paused",
  dnf: "Marked as DNF",
};

function StateChangeToast({ message, onDone }: { message: string; onDone: () => void }) {
  const [dismissing, setDismissing] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      if (mounted.current) setDismissing(true);
    }, 2200);
    const removeTimer = setTimeout(() => {
      if (mounted.current) onDone();
    }, 2500);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      clearTimeout(removeTimer);
    };
  }, [onDone]);

  return createPortal(
    <div
      className="fixed bottom-24 left-1/2 z-[200] flex items-center gap-2 rounded-full bg-surface border border-border px-4 py-2.5 shadow-lg"
      style={{
        animation: dismissing ? "toast-out 0.25s ease-in forwards" : "toast-in 0.25s ease-out",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span className="text-sm font-medium text-foreground">{message}</span>
    </div>,
    document.body
  );
}

const STATES = [
  { value: "tbr", label: "To Read" },
  { value: "currently_reading", label: "Reading Now" },
  { value: "completed", label: "Finished" },
  { value: "paused", label: "Paused" },
  { value: "dnf", label: "DNF" },
] as const;

interface ReadingStateButtonProps {
  bookId?: string;
  bookSlug?: string | null;
  olResult?: OLSearchResult;
  /** For results sourced from ISBNdb (via /api/search/external) */
  externalImport?: ExternalBookImportInput | null;
  currentState: string | null;
  isLoggedIn: boolean;
  compact?: boolean;
  isPremium?: boolean;
  initialTbrNote?: string | null;
  autoComplete?: boolean;
  onStateChange?: (newState: string | null) => void;
  onImported?: (olKey: string, bookId: string) => void;
}

export function ReadingStateButton({
  bookId,
  bookSlug,
  olResult,
  externalImport,
  currentState,
  isLoggedIn,
  compact = false,
  isPremium = false,
  initialTbrNote = null,
  autoComplete = false,
  onStateChange,
  onImported,
}: ReadingStateButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pendingState, setPendingState] = useState<"completed" | "dnf" | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  function showToast(state: string) {
    const msg = STATE_TOAST_MESSAGES[state];
    if (msg) setToastMessage(msg);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Auto-trigger completion flow (from Home page ?complete=true redirect)
  const autoCompleteTriggered = useRef(false);
  useEffect(() => {
    if (autoComplete && !autoCompleteTriggered.current && bookId && currentState === "currently_reading") {
      autoCompleteTriggered.current = true;
      setPendingState("completed");
      setDatePickerOpen(true);
    }
  }, [autoComplete, bookId, currentState]);

  const activeState = STATES.find((s) => s.value === currentState);
  const mainLabel = activeState?.label ?? "To Read";
  const isActive = !!currentState;

  function handleMainClick() {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    startTransition(async () => {
      if (isActive) {
        if (bookId) {
          await removeBookState(bookId);
          onStateChange?.(null);
        }
      } else {
        if (bookId) {
          await setBookState(bookId, "tbr");
          onStateChange?.("tbr");
          showToast("tbr");
        } else if (olResult) {
          const newId = await setBookStateWithImport(null, olResult, "tbr");
          onStateChange?.("tbr");
          showToast("tbr");
          onImported?.(olResult.key, newId);
        }
      }
    });
  }

  function handleStateSelect(state: string) {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    setOpen(false);

    // Intercept completed/dnf to show date picker first
    if ((state === "completed" || state === "dnf") && currentState !== state && bookId) {
      setPendingState(state);
      setDatePickerOpen(true);
      return;
    }

    startTransition(async () => {
      if (currentState === state) {
        if (bookId) {
          await removeBookState(bookId);
          onStateChange?.(null);
        }
      } else {
        if (bookId) {
          await setBookState(bookId, state);
          onStateChange?.(state);
          showToast(state);
        } else if (olResult) {
          const newId = await setBookStateWithImport(null, olResult, state);
          onStateChange?.(state);
          showToast(state);
          onImported?.(olResult.key, newId);
        } else if (externalImport) {
          // ISBNdb-sourced result — import via ISBNdb instead of OL
          const newId = await setBookStateWithImport(null, null, state, externalImport);
          onStateChange?.(state);
          showToast(state);
          onImported?.(`isbndb:${externalImport.isbn}`, newId);
        }
      }
    });
  }

  function handleDateConfirm(
    date: string | null,
    precision: "exact" | "month" | "year" | null
  ) {
    setDatePickerOpen(false);
    if (!pendingState || !bookId) return;
    const finalState = pendingState;
    setPendingState(null);
    startTransition(async () => {
      await setBookStateWithCompletion(bookId, finalState, date, precision);
      // In compact mode (search results), navigate to the book page so the
      // user can leave a review. The book page picks up ?review=true and
      // auto-opens the review wizard.
      if (compact && finalState === "completed") {
        router.push(`/book/${bookSlug || bookId}?review=true`);
        return;
      }
    });
    // Fire OUTSIDE transition so parent state updates (e.g., autoOpenReview)
    // aren't deferred by React's transition batching
    onStateChange?.(finalState);
    showToast(finalState);
  }

  function handleDateCancel() {
    setDatePickerOpen(false);
    setPendingState(null);
  }

  function handleRemove() {
    setOpen(false);
    setShowRemoveConfirm(true);
  }

  function handleConfirmRemove() {
    setShowRemoveConfirm(false);
    if (!bookId) return;
    startTransition(async () => {
      await removeFromLibrary(bookId);
    });
    // Fire OUTSIDE transition so parent state updates aren't deferred by
    // React's transition batching — same pattern as the completion flow.
    onStateChange?.(null);
  }

  // Compact mode for search results
  if (compact) {
    return (
      <>
        <div className="relative inline-flex" ref={dropdownRef}>
          <button
            onClick={handleMainClick}
            disabled={isPending}
            className={`rounded-l-full py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              isActive
                ? "px-3 bg-accent text-black border border-accent border-r-0"
                : "px-5 bg-accent/20 text-foreground border-2 border-accent/60 border-r-0 hover:bg-accent/30"
            } ${isPending ? "opacity-60" : ""}`}
          >
            {isPending ? "..." : isActive ? mainLabel : (
              <span className="inline-flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="7" x2="12" y2="13" />
                  <line x1="9" y1="10" x2="15" y2="10" />
                </svg>
                {mainLabel}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              if (!isLoggedIn) { router.push("/login"); return; }
              setOpen(!open);
            }}
            disabled={isPending}
            className={`rounded-r-full px-2 py-1.5 transition-colors border-l ${
              isActive
                ? "bg-accent text-black border border-accent border-l-black/20"
                : "bg-accent/20 text-foreground border-2 border-accent/60 border-l-accent/40 hover:bg-accent/30"
            } ${isPending ? "opacity-60" : ""}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {open && (
            <div className="absolute top-full left-0 mt-1 w-40 rounded-lg border border-border bg-surface shadow-lg z-50 popover-enter">
              {STATES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => handleStateSelect(s.value)}
                  className={`w-full px-4 py-2 text-left text-sm transition-colors first:rounded-t-lg ${
                    currentState === s.value
                      ? "bg-accent/15 text-foreground font-medium"
                      : "text-foreground hover:bg-surface-alt"
                  }`}
                >
                  {s.label}
                  {currentState === s.value && (
                    <span className="float-right text-accent">✓</span>
                  )}
                </button>
              ))}
              {isActive && (
                <button
                  onClick={handleRemove}
                  className="w-full px-4 py-2 text-left text-sm text-destructive hover:bg-surface-alt transition-colors rounded-b-lg border-t border-border"
                >
                  Remove from Library
                </button>
              )}
            </div>
          )}
        </div>

        {/* Completion date picker (compact) */}
        <CompletionDatePicker
          open={datePickerOpen}
          onClose={handleDateCancel}
          onConfirm={handleDateConfirm}
          label={pendingState === "dnf" ? "When did you stop reading?" : "When did you finish?"}
        />

        {/* Remove from library confirmation (compact) */}
        {showRemoveConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
            <div className="w-full max-w-xs rounded-2xl bg-surface border border-border p-5 shadow-2xl">
              <h3 className="text-base font-bold text-foreground text-center mb-2">
                Remove from Library?
              </h3>
              <p className="text-sm text-muted text-center mb-5">
                This will clear your reading history, review, and rating for this book. This cannot be undone.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleConfirmRemove}
                  disabled={isPending}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-destructive text-white hover:bg-destructive/90 transition-colors"
                >
                  {isPending ? "Removing..." : "Remove Everything"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRemoveConfirm(false)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {toastMessage && <StateChangeToast message={toastMessage} onDone={() => setToastMessage(null)} />}
      </>
    );
  }

  // Full mode for book page
  return (
    <>
      <div className="relative flex" ref={dropdownRef}>
        <button
          onClick={handleMainClick}
          disabled={isPending}
          className={`flex-1 min-w-0 rounded-l-xl h-[52px] flex items-center justify-center text-base font-semibold tracking-wide transition-all border-2 border-r-0 ${
            isActive
              ? "bg-accent text-black border-accent shadow-[0_0_20px_rgba(163,230,53,0.25)]"
              : "bg-accent/20 text-foreground border-accent/60 hover:bg-accent/30"
          } ${isPending ? "opacity-60" : ""}`}
        >
          {isPending ? "..." : isActive ? mainLabel : (
            <span className="inline-flex items-center justify-center gap-1.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                <line x1="12" y1="7" x2="12" y2="13" />
                <line x1="9" y1="10" x2="15" y2="10" />
              </svg>
              To Read
            </span>
          )}
        </button>
        <button
          onClick={() => {
            if (!isLoggedIn) { router.push("/login"); return; }
            setOpen(!open);
          }}
          disabled={isPending}
          className={`flex-shrink-0 rounded-r-xl px-4 h-[52px] flex items-center transition-all border-2 ${
            isActive
              ? "bg-accent text-black border-accent border-l-black/20 shadow-[0_0_20px_rgba(163,230,53,0.25)]"
              : "bg-accent/20 text-foreground border-accent/60 border-l-accent/40 hover:bg-accent/30"
          } ${isPending ? "opacity-60" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-border bg-surface shadow-xl z-50 popover-enter" onMouseDown={(e) => e.stopPropagation()}>
            {STATES.map((s) => (
              <button
                key={s.value}
                onClick={() => handleStateSelect(s.value)}
                className={`w-full px-5 py-3 text-left text-sm font-medium transition-colors first:rounded-t-xl ${
                  currentState === s.value
                    ? "bg-accent/15 text-foreground"
                    : "text-foreground hover:bg-surface-alt"
                }`}
              >
                {s.label}
                {currentState === s.value && (
                  <span className="float-right text-accent">✓</span>
                )}
              </button>
            ))}
            {currentState === "tbr" && bookId && (
              <div className="border-t border-border px-3 py-2">
                <TbrNoteEditor bookId={bookId} initialNote={initialTbrNote} isPremium={isPremium} />
              </div>
            )}
            {isActive && (
              <button
                onClick={handleRemove}
                className="w-full px-5 py-3 text-left text-sm font-medium text-destructive hover:bg-surface-alt transition-colors rounded-b-xl border-t border-border"
              >
                Remove from Library
              </button>
            )}
          </div>
        )}
      </div>

      {/* Completion date picker */}
      <CompletionDatePicker
        open={datePickerOpen}
        onClose={handleDateCancel}
        onConfirm={handleDateConfirm}
        label={pendingState === "dnf" ? "When did you stop reading?" : "When did you finish?"}
      />

      {/* Remove from library confirmation dialog */}
      {showRemoveConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-xs rounded-2xl bg-surface border border-border p-5 shadow-2xl">
            <h3 className="text-base font-bold text-foreground text-center mb-2">
              Remove from Library?
            </h3>
            <p className="text-sm text-muted text-center mb-5">
              This will clear your reading history, review, and rating for this book. This cannot be undone.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleConfirmRemove}
                disabled={isPending}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-destructive text-white hover:bg-destructive/90 transition-colors"
              >
                {isPending ? "Removing..." : "Remove Everything"}
              </button>
              <button
                type="button"
                onClick={() => setShowRemoveConfirm(false)}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && <StateChangeToast message={toastMessage} onDone={() => setToastMessage(null)} />}
    </>
  );
}
