"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { saveTbrNote, deleteTbrNote } from "@/lib/actions/tbr-notes";
import { PremiumBadge } from "@/components/premium-gate";
import Link from "next/link";

interface TbrNoteEditorProps {
  bookId: string;
  initialNote: string | null;
  isPremium: boolean;
}

const MAX_LENGTH = 500;

export function TbrNoteEditor({ bookId, initialNote, isPremium }: TbrNoteEditorProps) {
  const [note, setNote] = useState(initialNote ?? "");
  const [savedNote, setSavedNote] = useState(initialNote ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [showSaved, setShowSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  if (!isPremium) {
    return (
      <Link
        href="/upgrade"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-neon-purple/5 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        <span>Add a TBR note</span>
        <PremiumBadge />
      </Link>
    );
  }

  function handleSave() {
    const trimmed = note.trim();
    if (!trimmed || trimmed === savedNote) {
      setIsEditing(false);
      setNote(savedNote);
      return;
    }

    startTransition(async () => {
      const result = await saveTbrNote(bookId, trimmed);
      if (result.success) {
        setSavedNote(trimmed);
        setNote(trimmed);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 1500);
      }
      setIsEditing(false);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteTbrNote(bookId);
      if (result.success) {
        setNote("");
        setSavedNote("");
      }
      setIsEditing(false);
    });
  }

  // Editing state
  if (isEditing) {
    return (
      <div>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, MAX_LENGTH))}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            }
            if (e.key === "Escape") {
              setNote(savedNote);
              setIsEditing(false);
            }
          }}
          placeholder="Why do you want to read this?"
          rows={2}
          className="w-full resize-none rounded-lg border border-accent/30 bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-muted/50">{note.length}/{MAX_LENGTH}</span>
          {savedNote && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              Delete note
            </button>
          )}
        </div>
      </div>
    );
  }

  // Display state — has note
  if (savedNote) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="w-full text-left rounded-lg px-2 py-1.5 group hover:bg-accent/5 transition-colors"
      >
        <div style={{ lineHeight: '1.3' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent inline-block mr-1.5 -mt-0.5">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span className="text-[11px] text-muted">{savedNote}</span>
          <span className="text-[10px] text-muted/40 opacity-0 group-hover:opacity-100 transition-opacity ml-1">edit</span>
        </div>
        {showSaved && (
          <span className="block mt-0.5 text-[10px] text-accent">Saved</span>
        )}
      </button>
    );
  }

  // Display state — no note yet
  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted/60 hover:text-muted transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      Add a TBR note
    </button>
  );
}
