"use client";

import { useState, useTransition } from "react";
import { parseDbDate } from "@/lib/date-utils";
import Link from "next/link";
import Image from "next/image";
import { deleteReadingNote } from "@/lib/actions/reading-notes";
import { NoCover } from "@/components/no-cover";
import type { ReadingNoteWithBook } from "@/lib/queries/reading-notes";

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
    <div className="flex gap-3 rounded-[18px] border border-foreground/10 bg-surface/60 p-3 backdrop-blur-md transition-colors hover:border-foreground/25">
      <Link href={`/book/${note.bookSlug || note.bookId}`} className="flex-shrink-0">
        {note.bookCoverUrl ? (
          <Image
            src={note.bookCoverUrl}
            alt={`Cover of ${note.bookTitle}`}
            width={40}
            height={60}
            className="h-[60px] w-[40px] rounded-md object-cover shadow-md ring-1 ring-white/10"
          />
        ) : (
          <NoCover title={note.bookTitle} className="h-[60px] w-[40px]" size="sm" />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/book/${note.bookSlug || note.bookId}`}>
          <h4 className="text-sm font-semibold leading-tight line-clamp-1 hover:text-neon-blue transition-colors">{note.bookTitle}</h4>
        </Link>
        <div className="flex items-center gap-2 mt-0.5">
          {/* Mood and pace as glass chips with a dot, not emoji (2026-11
              refresh — the Reading Now tracker dropped them the same way). */}
          {note.mood && (
            <span className="inline-flex items-center gap-1 rounded-full border border-foreground/10 bg-surface/80 px-2 py-0.5 text-[10px] font-semibold capitalize text-foreground">
              <span className="h-[5px] w-[5px] rounded-full bg-neon-purple" aria-hidden="true" />
              {note.mood}
            </span>
          )}
          {note.pace && (
            <span className="inline-flex items-center gap-1 rounded-full border border-foreground/10 bg-surface/80 px-2 py-0.5 text-[10px] font-semibold capitalize text-foreground">
              <span className="h-[5px] w-[5px] rounded-full bg-neon-blue" aria-hidden="true" />
              {note.pace}
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
              {parseDbDate(note.createdAt).toLocaleDateString("en-US", {
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
