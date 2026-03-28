"use client";

import { useState, useTransition } from "react";
import { deleteReadingNote, toggleNotePrivacy } from "@/lib/actions/reading-notes";
import { NoteCard } from "@/components/book/book-reading-notes";
import type { ReadingNote } from "@/lib/queries/reading-notes";

export function BookNotesClient({ notes }: { notes: ReadingNote[] }) {
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [privacyOverrides, setPrivacyOverrides] = useState<Map<string, boolean>>(new Map());
  const [isPending, startTransition] = useTransition();

  const activeNotes = notes
    .filter((n) => !deletedIds.has(n.id))
    .map((n) => ({
      ...n,
      isPrivate: privacyOverrides.has(n.id) ? privacyOverrides.get(n.id)! : n.isPrivate,
    }));

  function handleDelete(noteId: string) {
    if (!confirm("Delete this note?")) return;
    setDeletedIds((prev) => new Set(prev).add(noteId));
    startTransition(async () => {
      await deleteReadingNote(noteId);
    });
  }

  function handleTogglePrivacy(noteId: string) {
    const note = activeNotes.find((n) => n.id === noteId);
    if (!note) return;
    const newPrivacy = !note.isPrivate;
    setPrivacyOverrides((prev) => new Map(prev).set(noteId, newPrivacy));
    startTransition(async () => {
      await toggleNotePrivacy(noteId);
    });
  }

  if (activeNotes.length === 0) {
    return <p className="text-sm text-muted">No notes yet.</p>;
  }

  return (
    <div className="space-y-3">
      {activeNotes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          onDelete={handleDelete}
          onTogglePrivacy={handleTogglePrivacy}
          isPending={isPending}
        />
      ))}
    </div>
  );
}
