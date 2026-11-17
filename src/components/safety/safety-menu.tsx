"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockUser, reportContent } from "@/lib/actions/blocks";

/**
 * The "⋯" menu on another reader's review or profile: Report and Block.
 * App Review guideline 1.2 requires both for user-generated content. iOS has
 * the same two actions (native-ios SafetyMenu) — keep the reasons in step
 * with REPORT_REASONS in src/lib/actions/blocks.ts.
 */
const REASONS: { key: string; label: string }[] = [
  { key: "spam", label: "Spam or advertising" },
  { key: "harassment", label: "Harassment or bullying" },
  { key: "hate", label: "Hate speech" },
  { key: "sexual", label: "Sexual or explicit content" },
  { key: "spoilers", label: "Spoilers without a warning" },
  { key: "other", label: "Something else" },
];

interface SafetyMenuProps {
  kind: "review" | "profile";
  targetUserId: string;
  /** Shown in the copy. Omit for an anonymous review, which also hides Block. */
  username?: string | null;
  reviewId?: string;
  bookId?: string;
  pageUrl?: string;
  /** Which edge the popover hangs from. */
  align?: "left" | "right";
}

type Panel = "menu" | "report" | "block" | "reported";

export function SafetyMenu({ kind, targetUserId, username, reviewId, bookId, pageUrl, align = "right" }: SafetyMenuProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const who = username ? `@${username}` : "this reader";

  function close() {
    setPanel(null);
    setReason(null);
    setDetails("");
    setError(null);
  }

  useEffect(() => {
    if (!panel) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [panel]);

  function sendReport() {
    if (!reason) return;
    setError(null);
    startTransition(async () => {
      const result = await reportContent({ kind, targetUserId, reviewId, bookId, reason, details, pageUrl });
      if (result.success) setPanel("reported");
      else setError(result.error === "Not logged in" ? "Sign in to report this." : result.error ?? "Couldn't send the report.");
    });
  }

  function confirmBlock() {
    setError(null);
    startTransition(async () => {
      const result = await blockUser(targetUserId);
      if (result.success) {
        close();
        router.refresh();
      } else {
        setError(result.error === "Not logged in" ? "Sign in to block a reader." : result.error ?? "Couldn't block this reader.");
      }
    });
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => (panel ? close() : setPanel("menu"))}
        aria-label={kind === "review" ? "Report or block" : "Report or block this reader"}
        aria-haspopup="menu"
        aria-expanded={panel !== null}
        className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-alt hover:text-foreground"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {panel && (
        <div
          role={panel === "menu" ? "menu" : "dialog"}
          className={`absolute top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-foreground/10 bg-surface/95 p-1.5 text-left shadow-xl backdrop-blur-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {panel === "menu" && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setPanel("report")}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground hover:bg-surface-alt"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden="true">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" x2="4" y1="22" y2="15" />
                </svg>
                {kind === "review" ? "Report this review" : "Report this profile"}
              </button>
              {username && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setPanel("block")}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive hover:bg-surface-alt"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" x2="19.07" y1="4.93" y2="19.07" />
                  </svg>
                  Block {who}
                </button>
              )}
            </>
          )}

          {panel === "report" && (
            <div className="p-2.5">
              <p className="text-sm font-bold text-foreground">Why are you reporting this?</p>
              <div className="mt-2 space-y-0.5">
                {REASONS.map((r) => (
                  <label key={r.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-surface-alt">
                    <input
                      type="radio"
                      name="report-reason"
                      value={r.key}
                      checked={reason === r.key}
                      onChange={() => setReason(r.key)}
                      className="h-4 w-4 accent-[#a3e635]"
                    />
                    {r.label}
                  </label>
                ))}
              </div>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="Anything else we should know? (optional)"
                className="mt-2 w-full resize-none rounded-lg border border-border bg-surface-alt px-3 py-2 text-base text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none"
              />
              {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <button type="button" onClick={close} className="px-3 py-2 text-sm text-muted hover:text-foreground">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={sendReport}
                  disabled={!reason || isPending}
                  className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
                >
                  {isPending ? "Sending…" : "Send report"}
                </button>
              </div>
            </div>
          )}

          {panel === "reported" && (
            <div className="p-2.5">
              <p className="text-sm font-bold text-foreground">Thanks — we&rsquo;ve got it</p>
              <p className="mt-1 text-sm text-muted">
                We review reports within 24 hours and remove anything that breaks our terms.
                {username ? ` You can also block ${who} so you stop seeing each other.` : ""}
              </p>
              <div className="mt-2.5 flex items-center justify-end gap-2">
                {username && (
                  <button type="button" onClick={() => setPanel("block")} className="px-3 py-2 text-sm font-medium text-destructive">
                    Block {who}
                  </button>
                )}
                <button type="button" onClick={close} className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-black">
                  Done
                </button>
              </div>
            </div>
          )}

          {panel === "block" && (
            <div className="p-2.5">
              <p className="text-sm font-bold text-foreground">Block {who}?</p>
              <p className="mt-1 text-sm text-muted">
                You won&rsquo;t see each other&rsquo;s reviews, profiles or buddy-read messages, and you&rsquo;ll stop
                following each other. They won&rsquo;t be told. You can unblock them in Settings.
              </p>
              {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <button type="button" onClick={close} className="px-3 py-2 text-sm text-muted hover:text-foreground">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmBlock}
                  disabled={isPending}
                  className="rounded-full bg-destructive px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {isPending ? "Blocking…" : "Block"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
