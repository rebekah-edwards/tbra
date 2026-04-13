"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { setBookState, removeBookState } from "@/lib/actions/reading-state";
import { setBookStateWithCompletion } from "@/lib/actions/reading-session";
import { addReadingNote } from "@/lib/actions/reading-notes";
import { NoCover } from "@/components/no-cover";
import { CompletionDatePicker } from "@/components/book/completion-date-picker";
import { ReviewWizard } from "@/components/review/review-wizard";

interface CurrentlyReadingBook {
  id: string;
  slug?: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  activeFormats?: string[];
  progress?: number | null; // 0-100 percentage
  pages?: number | null;
  buddyReadId?: string | null; // active buddy read for this book (if any)
}

const MOODS = [
  { key: "excited", emoji: "🤩", label: "Excited" },
  { key: "tense", emoji: "😰", label: "Tense" },
  { key: "emotional", emoji: "🥺", label: "Emotional" },
  { key: "bored", emoji: "😴", label: "Bored" },
  { key: "relaxed", emoji: "😌", label: "Relaxed" },
  { key: "curious", emoji: "🤔", label: "Curious" },
  { key: "confused", emoji: "😵‍💫", label: "Confused" },
  { key: "nostalgic", emoji: "🥹", label: "Nostalgic" },
];

const PACES = [
  { key: "slow", label: "Slow" },
  { key: "steady", label: "Steady" },
  { key: "fast", label: "Fast" },
  { key: "flying", label: "Flying" },
];

function TrackSheet({
  book,
  buddyReadId,
  onClose,
}: {
  book: CurrentlyReadingBook;
  buddyReadId?: string | null;
  onClose: () => void;
}) {
  const [noteText, setNoteText] = useState("");
  const [pageMode, setPageMode] = useState<"page" | "percent">("page");
  const [pageValue, setPageValue] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [pace, setPace] = useState<string | null>(null);
  const [showExtras, setShowExtras] = useState(false);
  const [shareToBuddyRead, setShareToBuddyRead] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);

  function handleSubmit() {
    if (!noteText.trim()) return;
    const formData = new FormData();
    formData.set("bookId", book.id);
    formData.set("noteText", noteText.trim());
    if (pageValue) {
      if (pageMode === "page") formData.set("pageNumber", pageValue);
      else formData.set("percentComplete", pageValue);
    }
    if (mood) formData.set("mood", mood);
    if (pace) formData.set("pace", pace);
    if (shareToBuddyRead && buddyReadId) formData.set("buddyReadId", buddyReadId);

    startTransition(async () => {
      const result = await addReadingNote(formData);
      if (result.success) {
        setSuccess(true);
        setTimeout(() => onClose(), 1500);
      }
    });
  }

  if (success) {
    return (
      <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-center">
        <p className="text-sm text-accent-dark font-medium">✓ Note saved</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3 space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">Tracking: {book.title}</p>
        <button onClick={onClose} className="text-xs text-muted hover:text-foreground">✕</button>
      </div>

      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="How's it going?"
        rows={2}
        maxLength={2000}
        className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm placeholder:text-muted resize-none"
        autoFocus
      />

      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setPageMode("page")}
            className={`px-2.5 py-1 ${pageMode === "page" ? "bg-accent text-black" : "text-muted"}`}
          >
            Page
          </button>
          <button
            onClick={() => setPageMode("percent")}
            className={`px-2.5 py-1 ${pageMode === "percent" ? "bg-accent text-black" : "text-muted"}`}
          >
            %
          </button>
        </div>
        <input
          type="number"
          min="0"
          max={pageMode === "percent" ? 100 : 99999}
          value={pageValue}
          onChange={(e) => setPageValue(e.target.value)}
          placeholder={pageMode === "page" ? "Page #" : "0-100"}
          className="w-20 rounded-lg border border-border bg-surface-alt px-2 py-1 text-xs text-center"
        />
        <button
          onClick={() => setShowExtras(!showExtras)}
          className="ml-auto text-xs text-muted hover:text-foreground transition-colors"
        >
          {showExtras ? "Less" : "Mood & pace"}
        </button>
      </div>

      {showExtras && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {MOODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMood(mood === m.key ? null : m.key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-all ${
                  mood === m.key
                    ? "bg-neon-purple/20 text-neon-purple border border-neon-purple/30"
                    : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
                }`}
              >
                {m.emoji} {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {PACES.map((p) => (
              <button
                key={p.key}
                onClick={() => setPace(pace === p.key ? null : p.key)}
                className={`rounded-full px-3 py-1 text-xs transition-all ${
                  pace === p.key
                    ? "bg-accent/20 text-accent-dark border border-accent/30"
                    : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {buddyReadId && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={shareToBuddyRead}
            onChange={(e) => setShareToBuddyRead(e.target.checked)}
            className="sr-only peer"
          />
          <div className="relative w-8 h-4 rounded-full bg-border peer-checked:bg-accent transition-colors">
            <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${shareToBuddyRead ? "translate-x-4" : ""}`} />
          </div>
          <span className="text-xs text-muted">Share to buddy read</span>
        </label>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={isPending || !noteText.trim()}
          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        <button onClick={onClose} className="text-xs text-muted hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

function ReadingBookCard({ book, onReviewOpen }: {
  book: CurrentlyReadingBook;
  onReviewOpen: (bookId: string, pages: number | null, isDnf: boolean, dnfPercent: number | null) => void;
}) {
  const [trackingBookId, setTrackingBookId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ bookId: string; state: string; label: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pendingCompleteState, setPendingCompleteState] = useState<"completed" | "dnf" | null>(null);
  const [openStateDropdown, setOpenStateDropdown] = useState<string | null>(null);
  const stateDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const router = useRouter();
  const isAudiobook = book.activeFormats?.length === 1 && book.activeFormats[0] === "audiobook";

  // Close state dropdown on outside click
  useEffect(() => {
    if (!openStateDropdown) return;
    function handleClick(e: MouseEvent) {
      const ref = stateDropdownRefs.current[openStateDropdown!];
      if (ref && !ref.contains(e.target as Node)) {
        setOpenStateDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openStateDropdown]);

  function handleStateChange(bookId: string, newState: string) {
    // Completed/DNF → show date picker inline (no navigation)
    if (newState === "completed" || newState === "dnf") {
      setPendingCompleteState(newState as "completed" | "dnf");
      setDatePickerOpen(true);
      return;
    }
    // Require confirmation for paused
    if (newState === "paused") {
      setConfirmAction({
        bookId,
        state: newState,
        label: "Pause",
      });
      return;
    }
    executeStateChange(bookId, newState);
  }

  function handleDateConfirm(date: string | null, precision: "exact" | "month" | "year" | null) {
    setDatePickerOpen(false);
    if (!pendingCompleteState) return;
    const finalState = pendingCompleteState;
    setPendingCompleteState(null);
    startTransition(async () => {
      await setBookStateWithCompletion(book.id, finalState, date, precision);
    });
    // Open review wizard via parent (survives this card's unmount)
    if (finalState === "completed") {
      onReviewOpen(book.id, book.pages ?? null, false, null);
    } else if (finalState === "dnf") {
      onReviewOpen(book.id, book.pages ?? null, true, book.progress ?? null);
    }
  }

  function handleDateCancel() {
    setDatePickerOpen(false);
    setPendingCompleteState(null);
  }

  function executeStateChange(bookId: string, newState: string) {
    setConfirmAction(null);
    startTransition(async () => {
      if (newState === "remove") {
        await removeBookState(bookId);
      } else {
        await setBookState(bookId, newState);
      }
    });
  }

  const isDropdownOpen = openStateDropdown === book.id;

  return (
    <div className={`relative ${isDropdownOpen ? "z-50" : ""}`}>
      {/* NOTE: outer wrapper intentionally does NOT use overflow-hidden so the
          reading-state dropdown can render outside the card bounds. The
          background image below has its own rounded clip. Outer wrapper gets
          z-50 when dropdown is open so it paints above the next sibling card. */}
      <div className="relative rounded-xl">
        {book.coverImageUrl && (
          <div className="absolute inset-0 overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={book.coverImageUrl} alt="" aria-hidden className="book-card-bg-img absolute inset-0 h-full w-full scale-150 object-cover" />
            <div className="absolute inset-0 currently-reading-overlay" />
          </div>
        )}
        {!book.coverImageUrl && (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-dark to-primary rounded-xl" />
        )}
        <div className="relative z-10 flex items-center gap-4 p-4">
          <Link href={`/book/${book.slug || book.id}`} className="flex-shrink-0 relative">
            {book.coverImageUrl ? (
              <Image
                src={book.coverImageUrl}
                alt={`Cover of ${book.title}`}
                width={isAudiobook ? 80 : 80}
                height={isAudiobook ? 80 : 120}
                className={`${isAudiobook ? "h-[80px] w-[80px]" : "h-[90px] w-[60px] lg:h-[140px] lg:w-[94px]"} rounded-lg object-cover shadow-xl`}
              />
            ) : (
              <NoCover title={book.title} className="h-[90px] w-[60px] lg:h-[140px] lg:w-[94px] shadow-xl" size="sm" />
            )}
            {/* Progress pill — frosted glass overlay on cover */}
            {book.progress != null && book.progress > 0 && (
              <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums backdrop-blur-md bg-surface/50 border border-neon-purple/30 text-neon-purple shadow-[0_2px_12px_rgba(192,132,252,0.25)] whitespace-nowrap">
                {book.progress}%
              </span>
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/book/${book.slug || book.id}`}>
              <h3 className="text-base font-bold book-header-text leading-snug">{book.title}</h3>
            </Link>
            {book.authors.length > 0 && (
              <p className="mt-1 text-sm book-header-text-muted line-clamp-2">{book.authors.join(", ")}</p>
            )}
          </div>
          {/* Action buttons — stacked on the right, equal width, fully opaque.
              Visual language matches book page: rounded-xl with 2px border.
              Narrow column (104px) so title/author have room to breathe. */}
          <div className={`flex flex-col gap-1.5 flex-shrink-0 w-[104px] ${isPending ? "opacity-50" : ""}`}>
            {/* Track Progress — solid blue rounded-xl */}
            <button
              onClick={() => setTrackingBookId(trackingBookId === book.id ? null : book.id)}
              className="w-full rounded-xl bg-neon-blue border-2 border-neon-blue px-2 py-1.5 text-[11px] font-semibold text-black shadow-sm hover:brightness-110 active:scale-[0.98] transition-all whitespace-nowrap"
              title="Track progress"
            >
              Track Progress
            </button>
            {/* Reading state split button — rounded-xl to match book page */}
            <div className="relative flex w-full" ref={(el) => { stateDropdownRefs.current[book.id] = el; }}>
              <button
                onClick={() => setOpenStateDropdown(openStateDropdown === book.id ? null : book.id)}
                className="flex-1 min-w-0 rounded-l-xl bg-accent border-2 border-accent border-r-0 px-2 py-1.5 text-[11px] font-semibold text-black text-center whitespace-nowrap flex items-center justify-center hover:brightness-110 active:scale-[0.98] transition-all"
                title="Change reading state"
              >
                Reading
              </button>
              <button
                onClick={() => setOpenStateDropdown(openStateDropdown === book.id ? null : book.id)}
                className="flex-shrink-0 rounded-r-xl bg-accent text-black border-2 border-accent border-l border-l-black/20 px-2 py-1.5 hover:brightness-110 active:scale-[0.98] transition-all"
                title="Change reading state"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {openStateDropdown === book.id && (
                <div className="absolute right-0 top-full mt-2 z-50 w-full rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
                  <button
                    onClick={() => { setOpenStateDropdown(null); handleStateChange(book.id, "completed"); }}
                    className="w-full px-3 py-2 text-left text-[13px] font-medium text-foreground hover:bg-surface-alt transition-colors border-b border-border/50"
                  >
                    Finished
                  </button>
                  <button
                    onClick={() => { setOpenStateDropdown(null); handleStateChange(book.id, "paused"); }}
                    className="w-full px-3 py-2 text-left text-[13px] font-medium text-foreground hover:bg-surface-alt transition-colors border-b border-border/50"
                  >
                    Paused
                  </button>
                  <button
                    onClick={() => { setOpenStateDropdown(null); handleStateChange(book.id, "dnf"); }}
                    className="w-full px-3 py-2 text-left text-[13px] font-medium text-foreground hover:bg-surface-alt transition-colors"
                  >
                    DNF
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Progress indicator is now on the book cover */}
      </div>
      {/* Confirmation prompt for DNF / Pause */}
      {confirmAction && (
        <div className="rounded-xl border border-border bg-surface p-3 mt-2 flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">
            Mark <strong className="font-semibold">{book.title}</strong> as {confirmAction.label}?
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setConfirmAction(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground border border-border hover:bg-surface-alt transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => executeStateChange(confirmAction.bookId, confirmAction.state)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-black bg-primary hover:brightness-110 transition-all"
            >
              {confirmAction.label}
            </button>
          </div>
        </div>
      )}
      {trackingBookId === book.id && (
        <TrackSheet book={book} buddyReadId={book.buddyReadId} onClose={() => setTrackingBookId(null)} />
      )}

      {/* Inline completion flow — date picker + review wizard */}
      <CompletionDatePicker
        open={datePickerOpen}
        onClose={handleDateCancel}
        onConfirm={handleDateConfirm}
        label={pendingCompleteState === "dnf" ? "When did you stop reading?" : "When did you finish?"}
      />
    </div>
  );
}

export function CurrentlyReadingSection({ books }: { books: CurrentlyReadingBook[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayBooks = showAll ? books : books.slice(0, 3);

  // Review wizard state lifted here so it survives card unmount
  // (when a book becomes "completed", the card unmounts but the wizard must stay open)
  const [reviewBookId, setReviewBookId] = useState<string | null>(null);
  const [reviewBookPages, setReviewBookPages] = useState<number | null>(null);
  const [reviewDnf, setReviewDnf] = useState(false);
  const [reviewDnfPercent, setReviewDnfPercent] = useState<number | null>(null);

  if (books.length === 0) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 border border-accent/20 p-6 text-center">
        <p className="text-lg font-semibold text-foreground/80">Nothing on the nightstand</p>
        <p className="mt-1 text-sm text-muted">
          Pick a book from your TBR or{" "}
          <Link href="/search" className="text-link hover:text-link/80">
            search for something new
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {displayBooks.map((book) => (
        <ReadingBookCard
          key={book.id}
          book={book}
          onReviewOpen={(bookId, pages, isDnf, dnfPercent) => {
            setReviewBookId(bookId);
            setReviewBookPages(pages);
            setReviewDnf(isDnf);
            setReviewDnfPercent(dnfPercent);
          }}
        />
      ))}
      {!showAll && books.length > 3 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-xs text-link hover:text-link/80 transition-colors py-2"
        >
          Show all ({books.length})
        </button>
      )}
      {/* Review wizard rendered at section level so it survives card unmount */}
      {reviewBookId && (
        <ReviewWizard
          bookId={reviewBookId}
          bookPages={reviewBookPages}
          open={!!reviewBookId}
          onClose={() => setReviewBookId(null)}
          isExisting={false}
          initialDnf={reviewDnf}
          initialDnfPercent={reviewDnf ? reviewDnfPercent : null}
        />
      )}
    </div>
  );
}
