"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { submitIssue } from "@/lib/actions/issues";

export function GlobalReportButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const pathname = usePathname();

  function handleSubmit() {
    if (!description.trim()) return;

    startTransition(async () => {
      // Extract book slug from pathname if on a book page
      const bookSlugMatch = pathname.match(/^\/book\/([^/]+)/);
      const bookSlug = bookSlugMatch?.[1] ?? undefined;

      const result = await submitIssue({
        pageUrl: pathname,
        description,
        bookSlug,
      });

      if (result.success) {
        setSubmitted(true);
        setTimeout(() => {
          setOpen(false);
          setSubmitted(false);
          setDescription("");
        }, 1500);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] right-4 lg:bottom-6 lg:right-6 z-50 w-11 h-11 rounded-full bg-yellow-500/15 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/25 hover:border-yellow-500/50 transition-all shadow-lg flex items-center justify-center"
        title="Report an issue"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" x2="4" y1="22" y2="15" />
        </svg>
      </button>

      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setDescription("");
          setSubmitted(false);
        }}
        title="Report Issue"
      >
        <div className="px-5 py-4 space-y-4">
          <div className="text-xs text-muted">
            <span className="font-medium text-foreground">Page</span>
            <span className="mx-1.5">·</span>
            <span>{pathname}</span>
          </div>

          {submitted ? (
            <div className="flex items-center gap-2 text-sm text-green-500 py-4">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Issue reported — queued for processing
            </div>
          ) : (
            <>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the issue..."
                rows={4}
                className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none"
                autoFocus
              />

              <button
                onClick={handleSubmit}
                disabled={isPending || !description.trim()}
                className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? "Submitting..." : "Submit Issue"}
              </button>
            </>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
