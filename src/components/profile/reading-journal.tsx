"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReadingNoteWithBook } from "@/lib/queries/reading-notes";
import { NoCover } from "@/components/no-cover";

const MOOD_MAP: Record<string, string> = {
  excited: "\u{1F525}", tense: "\u{1F630}", emotional: "\u{1F622}",
  bored: "\u{1F634}", relaxed: "\u{1F60C}", curious: "\u{1F914}",
  confused: "\u{1F635}", nostalgic: "\u{1F979}",
};

interface ReadingJournalProps {
  notes: ReadingNoteWithBook[];
}

export function ReadingJournal({ notes }: ReadingJournalProps) {
  if (notes.length === 0) {
    return (
      <section>
        <h2 className="section-heading text-sm mb-3">
          Reading Journal
        </h2>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted">No journal entries yet</p>
          <p className="mt-1 text-xs text-muted/60">
            Log your thoughts while reading from the home page
          </p>
        </div>
      </section>
    );
  }

  // Group notes by bookId
  const bookGroups = new Map<string, { title: string; slug: string | null; coverUrl: string | null; notes: ReadingNoteWithBook[] }>();
  for (const note of notes) {
    const existing = bookGroups.get(note.bookId);
    if (existing) {
      existing.notes.push(note);
    } else {
      bookGroups.set(note.bookId, {
        title: note.bookTitle,
        slug: note.bookSlug ?? null,
        coverUrl: note.bookCoverUrl,
        notes: [note],
      });
    }
  }

  return (
    <section>
      <h2 className="section-heading text-sm mb-3">
        Reading Journal ({notes.length})
      </h2>
      <div className="space-y-4">
        {Array.from(bookGroups.entries()).map(([bookId, group]) => {
          const topNote = group.notes[0];
          const peekCount = Math.min(group.notes.length - 1, 2);
          const linkTarget = `/book/${group.slug || bookId}/notes`;

          return (
            <div key={bookId}>
              {/* Book context */}
              <div className="flex items-center gap-2 mb-2">
                <Link href={`/book/${group.slug || bookId}`} className="flex-shrink-0">
                  {group.coverUrl ? (
                    <Image
                      src={group.coverUrl}
                      alt={group.title}
                      width={24}
                      height={36}
                      className="h-[36px] w-[24px] rounded object-cover"
                    />
                  ) : (
                    <NoCover title={group.title} className="h-[36px] w-[24px]" size="sm" />
                  )}
                </Link>
                <Link href={`/book/${group.slug || bookId}`} className="text-xs font-semibold hover:text-link transition-colors truncate">
                  {group.title}
                </Link>
                <span className="text-[10px] text-muted ml-auto flex-shrink-0">{group.notes.length} {group.notes.length === 1 ? "note" : "notes"}</span>
              </div>

              {/* Stacked card — clickable if multiple */}
              {group.notes.length > 1 ? (
                <Link href={linkTarget} className="block relative group">
                  {peekCount >= 2 && (
                    <div className="absolute bottom-[-12px] left-2 right-2 h-2 rounded-b-xl border border-t-0 border-border/30 bg-surface/50 z-0" />
                  )}
                  {peekCount >= 1 && (
                    <div className="absolute bottom-[-6px] left-1 right-1 h-2 rounded-b-xl border border-t-0 border-border/40 bg-surface/70 z-10" />
                  )}
                  <div className="relative z-20">
                    <NotePreview note={topNote} />
                  </div>
                </Link>
              ) : (
                <NotePreview note={topNote} />
              )}

              {group.notes.length > 1 && (
                <Link
                  href={linkTarget}
                  className="mt-4 flex items-center justify-center gap-1 text-xs font-medium read-more-link transition-colors"
                >
                  View all {group.notes.length} notes
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {notes.length > 5 && (
        <div className="mt-4 text-center">
          <Link
            href="/profile/journal"
            className="text-xs font-medium read-more-link"
          >
            View all {notes.length} entries →
          </Link>
        </div>
      )}
    </section>
  );
}

function NotePreview({ note }: { note: ReadingNoteWithBook }) {
  const mood = note.mood ? MOOD_MAP[note.mood] : null;
  return (
    <div className="rounded-xl border border-border/50 bg-surface p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] text-muted">
        {note.percentComplete != null && (
          <span className="rounded-full bg-surface-alt px-1.5 py-0.5">{note.percentComplete}%</span>
        )}
        {mood && <span>{mood}</span>}
        <span className="ml-auto">
          {new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </div>
      <p className="text-xs text-foreground/90 leading-relaxed line-clamp-2">{note.noteText}</p>
    </div>
  );
}
