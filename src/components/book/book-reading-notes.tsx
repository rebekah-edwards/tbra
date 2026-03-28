"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { deleteReadingNote } from "@/lib/actions/reading-notes";
import type { ReadingNote } from "@/lib/queries/reading-notes";

const MOOD_MAP: Record<string, { emoji: string; label: string }> = {
  excited: { emoji: "\u{1F525}", label: "Excited" },
  tense: { emoji: "\u{1F630}", label: "Tense" },
  emotional: { emoji: "\u{1F622}", label: "Emotional" },
  bored: { emoji: "\u{1F634}", label: "Bored" },
  relaxed: { emoji: "\u{1F60C}", label: "Relaxed" },
  curious: { emoji: "\u{1F914}", label: "Curious" },
  confused: { emoji: "\u{1F635}", label: "Confused" },
  nostalgic: { emoji: "\u{1F979}", label: "Nostalgic" },
};

const PACE_MAP: Record<string, { emoji: string; label: string }> = {
  slow: { emoji: "\u{1F422}", label: "Slow" },
  steady: { emoji: "\u{1F6B6}", label: "Steady" },
  fast: { emoji: "\u{1F3C3}", label: "Fast" },
  flying: { emoji: "\u{1F680}", label: "Flying" },
};

interface BookReadingNotesProps {
  notes: ReadingNote[];
  bookSlug?: string | null;
  bookId?: string;
}

export function NoteCard({
  note,
  onDelete,
  onTogglePrivacy,
  isPending,
}: {
  note: ReadingNote;
  onDelete?: (id: string) => void;
  onTogglePrivacy?: (id: string) => void;
  isPending?: boolean;
}) {
  const mood = note.mood ? MOOD_MAP[note.mood] : null;
  const pace = note.pace ? PACE_MAP[note.pace] : null;
  const isPrivate = note.isPrivate !== false; // default to private if undefined

  return (
    <div className="rounded-xl border border-border/50 bg-surface p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-xs text-muted">
        {note.percentComplete != null && (
          <span className="rounded-full bg-surface-alt px-2 py-0.5">
            {note.percentComplete}%
          </span>
        )}
        {note.pageNumber != null && (
          <span className="rounded-full bg-surface-alt px-2 py-0.5">
            p. {note.pageNumber}
          </span>
        )}
        {mood && (
          <span className="rounded-full bg-surface-alt px-2 py-0.5">
            {mood.emoji} {mood.label}
          </span>
        )}
        {pace && (
          <span className="rounded-full bg-surface-alt px-2 py-0.5">
            {pace.emoji} {pace.label}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {onTogglePrivacy && (
            <button
              onClick={() => onTogglePrivacy(note.id)}
              disabled={isPending}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
                isPrivate
                  ? "bg-surface-alt text-muted hover:text-foreground"
                  : "bg-accent/10 text-accent hover:bg-accent/20"
              }`}
              title={isPrivate ? "Only you can see this note. Click to share with friends." : "Visible to friends. Click to make private."}
            >
              {isPrivate ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                </svg>
              )}
              {isPrivate ? "Private" : "Shared"}
            </button>
          )}
          <span className="text-[10px]">
            {new Date(note.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          {onDelete && (
            <button
              onClick={() => onDelete(note.id)}
              disabled={isPending}
              className="text-muted/50 hover:text-red-400 transition-colors disabled:opacity-50"
              title="Delete note"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </span>
      </div>
      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
        {note.noteText}
      </p>
    </div>
  );
}

export function BookReadingNotes({ notes, bookSlug, bookId }: BookReadingNotesProps) {
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const activeNotes = notes.filter((n) => !deletedIds.has(n.id));

  function handleDelete(noteId: string) {
    if (!confirm("Delete this note?")) return;
    setDeletedIds((prev) => new Set(prev).add(noteId));
    startTransition(async () => {
      await deleteReadingNote(noteId);
    });
  }

  if (activeNotes.length === 0) return null;

  const topNote = activeNotes[0];
  const peekCount = Math.min(activeNotes.length - 1, 2);
  const hasMultiple = activeNotes.length > 1;
  // Use first note's bookId as fallback if no slug/bookId prop provided
  const resolvedBookId = bookSlug || bookId || topNote.bookId;
  const linkTarget = `/book/${resolvedBookId}/notes`;

  return (
    <section className="mt-8">
      <h2 className="section-heading text-sm mb-3">
        My Reading Notes ({activeNotes.length})
      </h2>

      {/* Stacked card effect — entire stack is clickable if multiple notes */}
      {hasMultiple ? (
        <Link href={linkTarget} className="block relative group">
          {peekCount >= 2 && (
            <div className="absolute bottom-[-12px] left-2 right-2 h-2 rounded-b-xl border border-t-0 border-border/30 bg-surface/50 z-0" />
          )}
          {peekCount >= 1 && (
            <div className="absolute bottom-[-6px] left-1 right-1 h-2 rounded-b-xl border border-t-0 border-border/40 bg-surface/70 z-10" />
          )}
          <div className="relative z-20 group-hover:border-primary/30 rounded-xl transition-colors">
            <NoteCard note={topNote} />
          </div>
        </Link>
      ) : (
        <div className="relative">
          <NoteCard note={topNote} onDelete={handleDelete} isPending={isPending} />
        </div>
      )}

      {/* View all link */}
      {hasMultiple && (
        <Link
          href={linkTarget}
          className="mt-5 flex items-center justify-center gap-1.5 text-sm font-medium read-more-link transition-colors py-2"
        >
          View all {activeNotes.length} notes
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      )}
    </section>
  );
}
