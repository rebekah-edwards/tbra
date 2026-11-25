"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { authorSaveDescription } from "@/lib/actions/author-claims";

/**
 * Shown on a book page to its verified author only: edit the description,
 * and a pointer to confirming ratings in What's Inside. Changes apply at
 * once; staff get a notification and can revert from /admin/authors.
 */
export function AuthorToolsCard({ bookId, description }: { bookId: string; description: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await authorSaveDescription(bookId, text);
      if (res.success) {
        setOpen(false);
        setSaved(true);
        router.refresh();
      } else setError(res.error ?? "Something went wrong");
    });
  };

  return (
    <section className="card-hairline mt-6 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-foreground/12 bg-surface/70">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Author tools</p>
          <p className="mt-0.5 text-sm text-foreground">You&apos;re this book&apos;s verified author.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Update the description, and tap the pencil on any rating in What&apos;s Inside to confirm it or correct it.
            {saved && " Description saved."}
          </p>
          <button type="button" onClick={() => setOpen(true)} className="btn-glass mt-3 px-4 py-1.5 text-xs">
            Edit description
          </button>
        </div>
      </div>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setOpen(false)}>
            <div className="card-hairline w-full max-w-lg space-y-3 p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit description">
              <p className="eyebrow">Author tools</p>
              <h2 className="font-heading text-lg font-bold text-foreground">Book description</h2>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                maxLength={6000}
                className="w-full rounded-2xl border border-foreground/12 bg-surface/70 p-3 text-sm leading-relaxed text-foreground"
              />
              <p className="text-xs text-muted">
                Blank lines start a new paragraph; **bold** and *italic* work. No spoilers past the setup, please.
                Our team is notified of every change.
              </p>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-glass px-4 py-2 text-sm">Cancel</button>
                <button type="button" onClick={save} disabled={isPending} className="btn-lime px-5 py-2 text-sm">
                  {isPending ? "Saving…" : "Save description"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
