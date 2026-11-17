"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveTbrNote, deleteTbrNote } from "@/lib/actions/tbr-notes";

const MAX_LENGTH = 500;

/**
 * The reader's private "note to self", shown on the book page it is about.
 *
 * The note could already be written from the reading-state menu, but it was
 * only ever *displayed* on the TBR list in My Library (Rebekah, 2026-11-16).
 * Renders nothing when there is no note: adding one still starts in the menu,
 * so a book without a note does not grow an empty box.
 *
 * Callers pass `key={initialNote}` so a note saved from the menu's editor
 * (which refreshes the page) remounts this card with the new text.
 */
export function NoteToSelfCard({
  bookId,
  initialNote,
  className = "",
}: {
  bookId: string;
  initialNote: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialNote ?? "");
  const [draft, setDraft] = useState(initialNote ?? "");
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && areaRef.current) {
      const el = areaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  if (!saved && !editing) return null;

  function save() {
    const next = draft.trim();
    if (!next) return remove();
    if (next === saved) return setEditing(false);
    startTransition(async () => {
      const result = await saveTbrNote(bookId, next);
      if (result.success) {
        setSaved(next);
        setDraft(next);
        router.refresh();
      }
      setEditing(false);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTbrNote(bookId);
      if (result.success) {
        setSaved("");
        setDraft("");
        router.refresh();
      }
      setEditing(false);
    });
  }

  return (
    <section
      aria-label="Note to self"
      className={`rounded-[18px] border border-neon-purple/30 bg-surface/60 p-4 backdrop-blur-md ${className}`}
    >
      <div className="flex items-center gap-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-neon-purple" aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
          <path d="M8 13h8M8 17h5" />
        </svg>
        <span className="eyebrow">Note to self</span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto text-xs font-medium text-neon-blue hover:text-neon-blue/80"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2.5">
          <textarea
            ref={areaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(saved);
                setEditing(false);
              }
            }}
            rows={3}
            placeholder="Why do you want to read this?"
            className="w-full resize-none rounded-2xl border border-foreground/12 bg-background/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={save} disabled={isPending} className="btn-lime px-4 py-1.5 text-xs">
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(saved);
                setEditing(false);
              }}
              className="btn-glass px-4 py-1.5 text-xs"
            >
              Cancel
            </button>
            <span className="ml-auto text-[11px] tabular-nums text-muted/60">{draft.length}/{MAX_LENGTH}</span>
            {saved && (
              <button type="button" onClick={remove} disabled={isPending} className="text-xs font-medium text-destructive hover:opacity-80">
                Delete
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">{saved}</p>
      )}
    </section>
  );
}
