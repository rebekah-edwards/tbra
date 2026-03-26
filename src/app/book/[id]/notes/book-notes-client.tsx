"use client";

import { useState, useTransition } from "react";
import { deleteReadingNote } from "@/lib/actions/reading-notes";
import { NoteCard } from "@/components/book/book-reading-notes";
import type { ReadingNote } from "@/lib/queries/reading-notes";

export function BookNotesClient({ notes }: { notes: ReadingNote[] }) {
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

  if (activeNotes.length === 0) {
    return <p className="text-sm text-muted">No notes yet.</p>;
  }

  return (
    <div className="space-y-3">
      {activeNotes.map((note) => (
        <NoteCard key={note.id} note={note} onDelete={handleDelete} isPending={isPending} />
      ))}
    </div>
  );
}
