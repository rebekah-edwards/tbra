"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { deleteReadingNote } from "@/lib/actions/reading-notes";
import { NoCover } from "@/components/no-cover";
import type { ReadingNoteWithBook } from "@/lib/queries/reading-notes";

const MOOD_MAP: Record<string, string> = {
  excited: "\u{1F525}",
  tense: "\u{1F630}",
  emotional: "\u{1F622}",
  bored: "\u{1F634}",
  relaxed: "\u{1F60C}",
  curious: "\u{1F914}",
  confused: "\u{1F635}",
  nostalgic: "\u{1F979}",
};

const PACE_MAP: Record<string, string> = {
  slow: "\u{1F422}",
  steady: "\u{1F6B6}",
  fast: "\u{1F3C3}",
  flying: "\u{1F680}",
};

interface JournalNoteCardProps {
  note: ReadingNoteWithBook;
  showYear?: boolean;
}

export function JournalNoteCard({ note, showYear = true }: JournalNoteCardProps) {
  const [deleted, setDeleted] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this note?")) return;
    setDeleted(true);
    startTransition(async () => {
      await deleteReadingNote(note.id);
    });
  }

  if (deleted) return null;

  return (
    <div className="flex gap-3 rounded-lg border border-border bg-surface p-3 hover:border-primary/30 transition-colors">
      <Link href={`/book/${note.bookSlug || note.bookId}`} className="flex-shrink-0">
        {note.bookCoverUrl ? (
          <Image
            src={note.bookCoverUrl}
            alt={`Cover of ${note.bookTitle}`}
            width={40}
            height={60}
            className="h-[60px] w-[40px] rounded object-cover"
          />
        ) : (
          <NoCover title={note.bookTitle} className="h-[60px] w-[40px]" size="sm" />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/book/${note.bookSlug || note.bookId}`}>
          <h4 className="text-sm font-semibold leading-tight line-clamp-1 hover:text-link transition-colors">{note.bookTitle}</h4>
        </Link>
        <div className="flex items-center gap-2 mt-0.5">
          {note.mood && (
            <span className="text-xs" title={note.mood}>
              {MOOD_MAP[note.mood] || note.mood}
            </span>
          )}
          {note.pace && (
            <span className="text-xs" title={`Pace: ${note.pace}`}>
              {PACE_MAP[note.pace] || note.pace}
            </span>
          )}
          {note.pageNumber != null && (
            <span className="text-[10px] text-muted">p. {note.pageNumber}</span>
          )}
          {note.percentComplete != null && (
            <span className="text-[10px] text-muted">{note.percentComplete}%</span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-muted">
              {new Date(note.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                ...(showYear ? { year: "numeric" } : {}),
              })}
            </span>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="text-muted/50 hover:text-red-400 transition-colors disabled:opacity-50"
              title="Delete note"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </span>
        </div>
        <p className="text-xs text-foreground/80 mt-1 line-clamp-3">{note.noteText}</p>
      </div>
    </div>
  );
}
