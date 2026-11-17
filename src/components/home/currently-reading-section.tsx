"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { setBookState, removeBookState } from "@/lib/actions/reading-state";
import { setBookStateWithCompletion, needsStartDate } from "@/lib/actions/reading-session";
import { addReadingNote } from "@/lib/actions/reading-notes";
import { NoCover } from "@/components/no-cover";
import { CompletionDatePicker } from "@/components/book/completion-date-picker";
import { ReviewWizard } from "@/components/review/review-wizard";

interface CurrentlyReadingBook {
  id: string;
  slug?: string | null;
  title: string;
  coverImageUrl: string | null;
  /** coverImageUrl is the real square audiobook image (see getUserBooks) */
  usesAudiobookCover?: boolean;
  authors: string[];
  activeFormats?: string[];
  progress?: number | null; // 0-100 percentage
  pages?: number | null;
  isFiction?: boolean | null;
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
  // Notes are private unless the reader turns this on. Progress is not
  // covered by it — friends see page/percent either way.
  const [shareNote, setShareNote] = useState(false);
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
    formData.set("isPrivate", shareNote ? "false" : "true");

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
        <p className="text-sm text-foreground font-medium">✓ Note saved</p>
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
        <div className="flex gap-0.5 rounded-full border border-foreground/10 bg-surface/70 p-0.5 text-xs">
          <button
            onClick={() => setPageMode("page")}
            className={`rounded-full px-2.5 py-1 ${pageMode === "page" ? "bg-foreground/12 text-foreground font-semibold" : "text-muted"}`}
          >
            Page
          </button>
          <button
            onClick={() => setPageMode("percent")}
            className={`rounded-full px-2.5 py-1 ${pageMode === "percent" ? "bg-foreground/12 text-foreground font-semibold" : "text-muted"}`}
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
                    ? "bg-foreground/10 text-foreground font-semibold border border-foreground/35"
                    : "bg-surface/70 text-muted border border-foreground/10 hover:text-foreground"
                }`}
              >
                {m.label}
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
                    ? "bg-accent/20 text-foreground border border-accent/30"
                    : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Share switch — off by default. */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={shareNote}
          onChange={(e) => setShareNote(e.target.checked)}
          className="sr-only peer"
        />
        <div className="relative w-8 h-4 flex-shrink-0 rounded-full bg-border peer-checked:bg-accent transition-colors">
          <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${shareNote ? "translate-x-4" : ""}`} />
        </div>
        <span className="text-xs text-muted">
          {shareNote ? "Friends can see this note" : "Share this note with friends"}
        </span>
      </label>

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
          className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
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
  onReviewOpen: (bookId: string, pages: number | null, isFiction: boolean | null, isDnf: boolean, dnfPercent: number | null) => void;
}) {
  const [trackingBookId, setTrackingBookId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ bookId: string; state: string; label: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // Offer a start date only when this book has none recorded yet.
  const [askStartDate, setAskStartDate] = useState(false);
  const [pendingCompleteState, setPendingCompleteState] = useState<"completed" | "dnf" | null>(null);
  const [openStateDropdown, setOpenStateDropdown] = useState<string | null>(null);
  const stateDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const router = useRouter();
  // Square frame ONLY when the resolved cover is the real square audiobook
  // image — an audiobook format choice alone must not square-crop a 2:3 cover.
  const isAudiobook = book.usesAudiobookCover === true;

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
      setAskStartDate(false);
      if (newState === "completed") needsStartDate(bookId).then(setAskStartDate);
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

  function handleDateConfirm(
    date: string | null,
    precision: "exact" | "month" | "year" | null,
    startedAt?: string | null
  ) {
    setDatePickerOpen(false);
    if (!pendingCompleteState) return;
    const finalState = pendingCompleteState;
    setPendingCompleteState(null);
    startTransition(async () => {
      await setBookStateWithCompletion(book.id, finalState, date, precision, startedAt);
    });
    // Open review wizard via parent (survives this card's unmount)
    if (finalState === "completed") {
      onReviewOpen(book.id, book.pages ?? null, book.isFiction ?? null, false, null);
    } else if (finalState === "dnf") {
      onReviewOpen(book.id, book.pages ?? null, book.isFiction ?? null, true, book.progress ?? null);
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
      <div className="relative rounded-[18px] currently-reading-card-base">
        {book.coverImageUrl && (
          <div className="absolute inset-0 overflow-hidden rounded-[18px]">
            <Image
              src={book.coverImageUrl}
              alt=""
              aria-hidden
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="book-card-bg-img scale-150 object-cover"
            />
            <div className="absolute inset-0 currently-reading-overlay" />
          </div>
        )}
        {!book.coverImageUrl && (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-dark to-accent rounded-[18px]" />
        )}
        {/* Design refresh 2026-11 (mirrors native-ios HomeView cardBodyV2):
            a real progress bar instead of the % tag under the cover, ONE lime
            action ("Update" = track progress), and the reading-state menu as
            a solid blue pill.
            Proportions (2026-11-16, later the same day): the slim version
            looked thin beside the goal and streak tiles, so the card takes
            their shell — 18px corners, 14px padding — with a larger cover,
            a thicker bar, the percent as a heading-font number and taller
            pills. Layout and behaviour are unchanged. */}
        <div className="relative z-10 flex items-center gap-3 p-3.5 lg:gap-4 lg:p-4">
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
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/book/${book.slug || book.id}`}>
              <h3 className="text-[17px] font-bold book-header-text leading-snug line-clamp-2">{book.title}</h3>
            </Link>
            {book.authors.length > 0 && (
              <p className="mt-0.5 text-[13px] lg:text-sm book-header-text-muted line-clamp-1">{book.authors.join(", ")}</p>
            )}
            {/* Progress bar — lime fill on a translucent track, % alongside */}
            <div className="mt-2.5 flex items-center gap-2.5">
              <div
                className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/15"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={book.progress ?? 0}
                aria-label="Reading progress"
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(0, Math.min(100, book.progress ?? 0))}%` }}
                />
              </div>
              <span className={`tabular-nums whitespace-nowrap book-header-text ${book.progress ? "font-heading text-xl font-extrabold leading-none" : "text-[11px] font-bold opacity-50"}`}>
                {book.progress ? `${book.progress}%` : "Not started"}
              </span>
            </div>
          </div>
          {/* Action buttons — stacked on the right, equal width. */}
          <div className={`flex flex-col gap-2 flex-shrink-0 w-[100px] ${isPending ? "opacity-50" : ""}`}>
            {/* Update — the one lime action. Black text on solid lime, always. */}
            <button
              onClick={() => setTrackingBookId(trackingBookId === book.id ? null : book.id)}
              className="w-full rounded-full bg-accent px-2 py-2.5 text-[13px] font-bold text-black hover:brightness-110 active:scale-[0.98] transition-all whitespace-nowrap flex items-center justify-center gap-1"
              title="Track progress"
              aria-label="Track progress"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Update
            </button>
            {/* Reading state menu — solid blue (not grey: Rebekah 2026-11-16),
                white text in both themes like the other solid-blue pills. */}
            <div className="relative flex w-full" ref={(el) => { stateDropdownRefs.current[book.id] = el; }}>
              <button
                onClick={() => setOpenStateDropdown(openStateDropdown === book.id ? null : book.id)}
                className="w-full rounded-full bg-[#0ea5e9] px-2 py-2.5 text-[13px] font-bold text-white whitespace-nowrap flex items-center justify-center gap-1 hover:brightness-110 active:scale-[0.98] transition-all"
                title="Change reading state"
                aria-haspopup="menu"
                aria-expanded={openStateDropdown === book.id}
              >
                Reading
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {openStateDropdown === book.id && (
                <div className="absolute right-0 top-full mt-2 z-50 w-full rounded-2xl border border-foreground/10 bg-surface/95 shadow-xl backdrop-blur-xl overflow-hidden">
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
        <div className="rounded-[18px] border border-foreground/10 bg-surface/90 p-3 mt-2 flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">
            Mark <strong className="font-semibold">{book.title}</strong> as {confirmAction.label}?
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setConfirmAction(null)}
              className="btn-glass px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              onClick={() => executeStateChange(confirmAction.bookId, confirmAction.state)}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-black bg-accent hover:brightness-110 transition-all"
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
        askStartDate={askStartDate && pendingCompleteState === "completed"}
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
  const [reviewBookIsFiction, setReviewBookIsFiction] = useState<boolean | null>(null);
  const [reviewDnf, setReviewDnf] = useState(false);
  const [reviewDnfPercent, setReviewDnfPercent] = useState<number | null>(null);

  if (books.length === 0) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 border border-accent/20 p-6 text-center">
        <p className="text-lg font-semibold text-foreground/80">Nothing on the nightstand</p>
        <p className="mt-1 text-sm text-muted">
          Pick a book from your TBR or{" "}
          <Link href="/search" className="text-neon-blue hover:text-neon-blue/80">
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
          onReviewOpen={(bookId, pages, isFiction, isDnf, dnfPercent) => {
            setReviewBookId(bookId);
            setReviewBookPages(pages);
            setReviewBookIsFiction(isFiction);
            setReviewDnf(isDnf);
            setReviewDnfPercent(dnfPercent);
          }}
        />
      ))}
      {!showAll && books.length > 3 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-xs text-neon-blue hover:text-neon-blue/80 transition-colors py-2"
        >
          Show all ({books.length})
        </button>
      )}
      {/* Review wizard rendered at section level so it survives card unmount */}
      {reviewBookId && (
        <ReviewWizard
          bookId={reviewBookId}
          bookPages={reviewBookPages}
          isFiction={reviewBookIsFiction}
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
