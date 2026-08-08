"use client";

import Link from "next/link";
import { useState } from "react";

interface ReferralCardProps {
  code: string;
  count: number;
}

export function ReferralCard({ code, count }: ReferralCardProps) {
  const [copied, setCopied] = useState(false);

  const referralLink = `https://thebasedreader.app/signup?ref=${code}`;

  function handleCopy() {
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" x2="19" y1="8" y2="14" />
            <line x1="22" x2="16" y1="11" y2="11" />
          </svg>
          Invite Friends
        </h2>
      </div>
      <p className="text-xs text-muted mb-3">
        Share your link and we&apos;ll track who joins through you.
      </p>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted font-mono truncate select-all">
          {referralLink}
        </div>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-primary/90"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Always rendered, directly under the link. It used to be a pill up in
          the header that only appeared once count > 0 — so the one state where
          you most want to check ("has anyone joined yet?") showed nothing at
          all, and there was no way in to the list. */}
      <Link
        href="/profile/referrals"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-neon-blue hover:underline"
      >
        {count === 0
          ? "No one has joined yet — see details"
          : `${count} ${count === 1 ? "person has" : "people have"} joined through your link`}
        <span aria-hidden>&rarr;</span>
      </Link>
    </div>
  );
}
