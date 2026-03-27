"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { setBookState, removeBookState } from "@/lib/actions/reading-state";
import { addReadingNote } from "@/lib/actions/reading-notes";
import { NoCover } from "@/components/no-cover";

interface CurrentlyReadingBook {
  id: string;
  slug?: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  activeFormats?: string[];
  progress?: number | null; // 0-100 percentage
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
  onClose,
}: {
  book: CurrentlyReadingBook;
  onClose: () => void;
}) {
  const [noteText, setNoteText] = useState("");
  const [pageMode, setPageMode] = useState<"page" | "percent">("page");
  const [pageValue, setPageValue] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [pace, setPace] = useState<string | null>(null);
  const [showExtras, setShowExtras] = useState(false);
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
            className={`px-2.5 py-1 ${pageMode === "page" ? "bg-primary text-background" : "text-muted"}`}
          >
            Page
          </button>
          <button
            onClick={() => setPageMode("percent")}
            className={`px-2.5 py-1 ${pageMode === "percent" ? "bg-primary text-background" : "text-muted"}`}
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

      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={isPending || !noteText.trim()}
          className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        <button onClick={onClose} className="text-xs text-muted hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

function ReadingBookCard({ book }: { book: CurrentlyReadingBook }) {
  const [trackingBookId, setTrackingBookId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isAudiobook = book.activeFormats?.length === 1 && book.activeFormats[0] === "audiobook";

  function handleStateChange(bookId: string, newState: string) {
    startTransition(async () => {
      if (newState === "remove") {
        await removeBookState(bookId);
      } else {
        await setBookState(bookId, newState);
      }
    });
  }

  return (
    <div>
      <div className="relative rounded-xl overflow-hidden">
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
              <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums backdrop-blur-md bg-surface/70 border border-neon-purple/30 text-neon-purple shadow-[0_2px_12px_rgba(192,132,252,0.25)] whitespace-nowrap">
                {book.progress}%
              </span>
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/book/${book.slug || book.id}`}>
              <h3 className="text-base font-bold book-header-text leading-tight line-clamp-2">{book.title}</h3>
            </Link>
            {book.authors.length > 0 && (
              <p className="mt-0.5 text-sm book-header-text-muted line-clamp-1">{book.authors.join(", ")}</p>
            )}
            {book.activeFormats && book.activeFormats.length > 0 && (
              <div className="hidden lg:flex gap-1.5 mt-1.5">
                {book.activeFormats.map((fmt) => (
                  <span key={fmt} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 book-header-text-muted capitalize">
                    {fmt}
                  </span>
                ))}
              </div>
            )}
          </div>
          {/* Action buttons */}
          <div className={`flex flex-col gap-1.5 flex-shrink-0 ${isPending ? "opacity-50" : ""}`}>
            {/* Track (journal) */}
            <button
              onClick={() => setTrackingBookId(trackingBookId === book.id ? null : book.id)}
              className="flex flex-col items-center gap-0.5 rounded-lg book-action-btn px-2 py-1.5 hover:brightness-110 transition-all backdrop-blur-sm"
              title="Track reading"
            >
              <span className="text-sm">📝</span>
              <span className="text-[9px] font-semibold">Track</span>
            </button>
            {/* Quick state icons row */}
            <div className="flex gap-1">
              {/* Finished (check) */}
              <button
                onClick={() => handleStateChange(book.id, "completed")}
                className="flex h-7 w-7 items-center justify-center rounded-md book-action-btn hover:brightness-110 transition-colors backdrop-blur-sm"
                title="Mark as finished"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              {/* Pause */}
              <button
                onClick={() => handleStateChange(book.id, "paused")}
                className="flex h-7 w-7 items-center justify-center rounded-md book-action-btn hover:brightness-110 transition-colors backdrop-blur-sm"
                title="Pause"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </button>
              {/* DNF (flag) */}
              <button
                onClick={() => handleStateChange(book.id, "dnf")}
                className="flex h-7 w-7 items-center justify-center rounded-md book-action-btn hover:brightness-110 transition-colors backdrop-blur-sm"
                title="Did not finish"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {/* Progress indicator is now on the book cover */}
      </div>
      {trackingBookId === book.id && (
        <TrackSheet book={book} onClose={() => setTrackingBookId(null)} />
      )}
    </div>
  );
}

export function CurrentlyReadingSection({ books }: { books: CurrentlyReadingBook[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayBooks = showAll ? books : books.slice(0, 3);

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
        <ReadingBookCard key={book.id} book={book} />
      ))}
      {!showAll && books.length > 3 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-xs text-link hover:text-link/80 transition-colors py-2"
        >
          Show all ({books.length})
        </button>
      )}
    </div>
  );
}
