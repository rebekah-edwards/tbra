"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { claimAuthorPage } from "@/lib/actions/author-claims";

/**
 * "Is this you?" — lets an author ask to have this page linked to their
 * account. A person on the team reviews every claim (/admin/authors).
 */
export function ClaimAuthorButton({
  authorId,
  authorName,
  pending,
}: {
  authorId: string;
  authorName: string;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(pending);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [links, setLinks] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/12 bg-surface/70 px-3 py-1.5 text-xs text-muted backdrop-blur-md">
        <span className="h-1.5 w-1.5 rounded-full bg-neon-blue" aria-hidden="true" />
        Claim waiting for review
      </span>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await claimAuthorPage(authorId, { evidenceLinks: links, contactEmail: email, message });
      if (res.success) {
        setDone(true);
        setOpen(false);
      } else setError(res.error ?? "Something went wrong");
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-glass px-4 py-1.5 text-xs">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        Are you {authorName}? Claim this page
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setOpen(false)}>
            <div
              className="card-hairline w-full max-w-md space-y-3 p-5"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={`Claim ${authorName}'s author page`}
            >
              <p className="eyebrow">Author verification</p>
              <h2 className="font-heading text-lg font-bold text-foreground">Claim {authorName}&apos;s page</h2>
              <p className="text-sm leading-relaxed text-muted">
                Once someone on our team confirms it&apos;s you, your profile gets a Verified Author badge and you can
                update your books&apos; descriptions and confirm their content ratings.
              </p>
              <label className="block text-xs font-semibold text-foreground">
                Your website or social profiles
                <textarea
                  value={links}
                  onChange={(e) => setLinks(e.target.value)}
                  rows={2}
                  placeholder="https://… — we check these link back to you"
                  className="mt-1 w-full rounded-2xl border border-foreground/12 bg-surface/70 p-3 text-sm font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-foreground">
                Contact email (ideally the one on your website)
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field-glass mt-1 w-full px-4 text-sm font-normal"
                />
              </label>
              <label className="block text-xs font-semibold text-foreground">
                Anything else we should know (optional)
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-2xl border border-foreground/12 bg-surface/70 p-3 text-sm font-normal"
                />
              </label>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="btn-glass px-4 py-2 text-sm">
                  Cancel
                </button>
                <button type="button" onClick={submit} disabled={isPending} className="btn-lime px-5 py-2 text-sm">
                  {isPending ? "Sending…" : "Send for review"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
