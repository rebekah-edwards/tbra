"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setBookState, removeBookState, setBookStateWithImport, removeFromLibrary } from "@/lib/actions/reading-state";
import type { OLSearchResult } from "@/lib/openlibrary";

const STATES = [
  { value: "tbr", label: "To Read" },
  { value: "currently_reading", label: "Reading Now" },
  { value: "completed", label: "Finished" },
  { value: "paused", label: "Paused" },
  { value: "dnf", label: "DNF" },
] as const;

interface ReadingStateButtonProps {
  bookId?: string;
  olResult?: OLSearchResult;
  currentState: string | null;
  isLoggedIn: boolean;
  compact?: boolean;
  onStateChange?: (newState: string | null) => void;
  onImported?: (olKey: string, bookId: string) => void;
}

export function ReadingStateButton({
  bookId,
  olResult,
  currentState,
  isLoggedIn,
  compact = false,
  onStateChange,
  onImported,
}: ReadingStateButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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
        } else if (olResult) {
          const newId = await setBookStateWithImport(null, olResult, "tbr");
          onStateChange?.("tbr");
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
        } else if (olResult) {
          const newId = await setBookStateWithImport(null, olResult, state);
          onStateChange?.(state);
          onImported?.(olResult.key, newId);
        }
      }
    });
  }

  function handleRemove() {
    setOpen(false);
    setShowRemoveConfirm(true);
  }

  function handleConfirmRemove() {
    setShowRemoveConfirm(false);
    startTransition(async () => {
      if (bookId) {
        await removeFromLibrary(bookId);
        onStateChange?.(null);
      }
    });
  }

  // Compact mode for search results
  if (compact) {
    return (
      <div className="relative inline-flex" ref={dropdownRef}>
        <button
          onClick={handleMainClick}
          disabled={isPending}
          className={`rounded-l-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
            isActive
              ? "bg-primary/15 text-primary border border-primary/30 border-r-0"
              : "bg-primary text-background border border-primary border-r-0 hover:brightness-110"
          } ${isPending ? "opacity-60" : ""}`}
        >
          {isPending ? "..." : isActive ? mainLabel : `+ ${mainLabel}`}
        </button>
        <button
          onClick={() => {
            if (!isLoggedIn) { router.push("/login"); return; }
            setOpen(!open);
          }}
          disabled={isPending}
          className={`rounded-r-full px-2 py-1.5 transition-colors border-l ${
            isActive
              ? "bg-primary/15 text-primary border border-primary/30 border-l-primary/20"
              : "bg-primary text-background border border-primary border-l-background/20 hover:brightness-110"
          } ${isPending ? "opacity-60" : ""}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1 w-40 rounded-lg border border-border bg-surface shadow-lg z-50">
            {STATES.map((s) => (
              <button
                key={s.value}
                onClick={() => handleStateSelect(s.value)}
                className={`w-full px-4 py-2 text-left text-sm transition-colors first:rounded-t-lg ${
                  currentState === s.value
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground hover:bg-surface-alt"
                }`}
              >
                {s.label}
                {currentState === s.value && (
                  <span className="float-right text-primary">✓</span>
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
    );
  }

  // Full mode for book page
  return (
    <>
      <div className="relative flex" ref={dropdownRef}>
        <button
          onClick={handleMainClick}
          disabled={isPending}
          className={`flex-1 min-w-0 rounded-l-xl py-3 text-base font-semibold tracking-wide transition-all ${
            isActive
              ? "bg-primary/15 text-primary border border-primary/30 border-r-0"
              : "bg-primary text-background shadow-[0_0_20px_rgba(163,230,53,0.25)] hover:shadow-[0_0_28px_rgba(163,230,53,0.4)] hover:brightness-110"
          } ${isPending ? "opacity-60" : ""}`}
        >
          {isPending ? "..." : isActive ? mainLabel : "+ To Read"}
        </button>
        <button
          onClick={() => {
            if (!isLoggedIn) { router.push("/login"); return; }
            setOpen(!open);
          }}
          disabled={isPending}
          className={`flex-shrink-0 rounded-r-xl px-4 py-3 transition-all ${
            isActive
              ? "bg-primary/15 text-primary border border-primary/30 border-l-primary/20"
              : "bg-primary text-background border-l border-background/20 shadow-[0_0_20px_rgba(163,230,53,0.25)] hover:shadow-[0_0_28px_rgba(163,230,53,0.4)] hover:brightness-110"
          } ${isPending ? "opacity-60" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-border bg-surface shadow-xl z-50">
            {STATES.map((s) => (
              <button
                key={s.value}
                onClick={() => handleStateSelect(s.value)}
                className={`w-full px-5 py-3 text-left text-sm font-medium transition-colors first:rounded-t-xl ${
                  currentState === s.value
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-surface-alt"
                }`}
              >
                {s.label}
                {currentState === s.value && (
                  <span className="float-right text-primary">✓</span>
                )}
              </button>
            ))}
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
    </>
  );
}
