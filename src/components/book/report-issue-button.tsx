"use client";

import { useState, useTransition, useEffect } from "react";
import { usePathname } from "next/navigation";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { submitIssue } from "@/lib/actions/issues";

interface ReportIssueButtonProps {
  bookId?: string;
  bookTitle?: string;
  seriesId?: string;
  seriesName?: string;
  /** render as a labeled "Report an issue" control (book footer, iOS parity)
   *  instead of the bare flag icon */
  labeled?: boolean;
}

export function ReportIssueButton({
  bookId,
  bookTitle,
  seriesId,
  seriesName,
  labeled = false,
}: ReportIssueButtonProps) {
  const contextLabel = bookTitle || seriesName || "Unknown";
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slowSubmit, setSlowSubmit] = useState(false);
  const pathname = usePathname();

  // Surface a "still working" message at 12s so the user doesn't think the
  // app silently lost their report. The submit can legitimately take this
  // long on cold starts, but without feedback the user reasonably assumes
  // it failed and re-submits or walks away.
  useEffect(() => {
    if (!isPending) {
      setSlowSubmit(false);
      return;
    }
    const t = setTimeout(() => setSlowSubmit(true), 12_000);
    return () => clearTimeout(t);
  }, [isPending]);

  function handleSubmit() {
    if (!description.trim()) return;
    setError(null);

    startTransition(async () => {
      try {
        const result = await submitIssue({
          bookId,
          seriesId,
          pageUrl: pathname,
          description,
        });

        if (result.success) {
          setSubmitted(true);
          setTimeout(() => {
            setOpen(false);
            setSubmitted(false);
            setDescription("");
          }, 1500);
        } else {
          setError(result.error || "Failed to submit. Please try again.");
        }
      } catch (e) {
        // Network failure, server crash, or stale-bundle ChunkLoadError mid-submit.
        // The description stays in the textarea so the user can retry without
        // re-typing everything.
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Submit failed: ${msg}. Your text is still here — try again.`);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          labeled
            ? "flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-yellow-500 transition-colors"
            : "p-1.5 rounded-lg text-muted hover:text-yellow-500 hover:bg-yellow-500/10 transition-colors"
        }
        title="Report data issue"
        data-coach-anchor={labeled ? "tour-report" : undefined}
      >
        <svg
          width="16"
          height="16"
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
        {labeled && "Report an issue"}
      </button>

      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setDescription("");
          setSubmitted(false);
          setError(null);
        }}
        title="Report Issue"
      >
        <div className="px-5 py-4 space-y-4">
          {/* Context */}
          <div className="text-xs text-muted">
            <span className="font-medium text-foreground">{contextLabel}</span>
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
                placeholder="Describe the issue... (e.g. 'defaults to non-English cover', 'sub-genre Christian Fiction is inaccurate')"
                rows={4}
                className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none"
                autoFocus
              />

              {error && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  {error}
                </div>
              )}

              {isPending && slowSubmit && !error && (
                <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
                  Still working — server is taking longer than usual. Don&apos;t close this.
                </div>
              )}

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
