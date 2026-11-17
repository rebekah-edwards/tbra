import Link from "next/link";
import Image from "next/image";
import type { SharedNote } from "@/lib/queries/reading-notes";
import { NoCover } from "@/components/no-cover";
import { parseDbDate } from "@/lib/date-utils";

// Reading notes a reader marked shared ("Visible to friends"), on their
// public profile. The page only passes notes to viewers who follow them.

function progress(note: SharedNote): string | null {
  if (note.percentComplete != null && note.percentComplete > 0) return `${note.percentComplete}% read`;
  if (note.pageNumber != null && note.pageNumber > 0) return `p. ${note.pageNumber}`;
  return null;
}

export function SharedNotes({ notes }: { notes: SharedNote[] }) {
  if (notes.length === 0) return null;

  return (
    <section id="notes" className="scroll-mt-24">
      <h2 className="section-heading text-xl mb-4">Reading Notes</h2>
      <div className="space-y-2.5">
        {notes.map((note) => {
          const where = progress(note);
          const when = parseDbDate(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          return (
            <Link
              key={note.id}
              href={`/book/${note.bookSlug || note.bookId}`}
              className="flex gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-foreground/25"
            >
              {note.bookCoverUrl ? (
                <Image
                  src={note.bookCoverUrl}
                  alt=""
                  width={40}
                  height={60}
                  loading="lazy"
                  className="h-[60px] w-10 flex-shrink-0 rounded object-cover shadow-md"
                />
              ) : (
                <NoCover title={note.bookTitle} className="h-[60px] w-10 flex-shrink-0" size="sm" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground line-clamp-1">{note.bookTitle}</p>
                <p className="mt-0.5 text-[11px] text-muted" suppressHydrationWarning>
                  {where ? `${where} · ${when}` : when}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80 line-clamp-4">
                  &ldquo;{note.noteText}&rdquo;
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
