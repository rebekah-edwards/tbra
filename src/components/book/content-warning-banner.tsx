"use client";

import { useState } from "react";
import { getWarningLabel } from "@/lib/content-warnings/vocabulary";

interface ContentConflict {
  categoryName: string;
  bookIntensity: number;
  userMax: number;
}

/**
 * Reviewer-flagged custom warning that matches a user's "topics to avoid"
 * preference. Distinct from ContentConflict — those come from admin-curated
 * taxonomy categories, these come from individual reviewers typing custom
 * content warnings on their reviews.
 */
export interface CustomWarningMatch {
  canonicalId: string;
  count: number;
}

/**
 * Canonical warning detected inside the admin-curated notes of a
 * bookCategoryRatings row (e.g. notes on "Sexual content" that mention
 * "adultery"). Same vocabulary, different evidence source.
 */
export interface NoteWarningMatch {
  canonicalId: string;
  categoryName: string;
}

interface ContentWarningBannerProps {
  conflicts: ContentConflict[];
  customWarningMatches?: CustomWarningMatch[];
  noteWarningMatches?: NoteWarningMatch[];
}

const INTENSITY_LABELS: Record<number, string> = {
  0: "none",
  1: "mild",
  2: "moderate",
  3: "significant",
  4: "extreme",
};

const TOLERANCE_LABELS: Record<number, string> = {
  0: "none",
  1: "mild",
  2: "moderate",
};

export function ContentWarningBanner({
  conflicts,
  customWarningMatches = [],
  noteWarningMatches = [],
}: ContentWarningBannerProps) {
  const [expanded, setExpanded] = useState(false);

  // De-dupe: if the same canonical warning appears in both reviewer flags AND
  // admin notes, count it once and prefer showing the reviewer row (it has a
  // concrete count). Note matches still render for any canonical not covered
  // by a reviewer flag so the user sees every hit exactly once.
  const reviewerWarningIds = new Set(customWarningMatches.map((m) => m.canonicalId));
  // Collapse repeated canonicals across categories into a single entry with
  // the category list merged — previously a warning noted in both
  // "Sexual content" and "Other" rendered as two separate rows.
  const noteMergedMap = new Map<string, { canonicalId: string; categoryNames: string[] }>();
  for (const n of noteWarningMatches) {
    if (reviewerWarningIds.has(n.canonicalId)) continue;
    const entry = noteMergedMap.get(n.canonicalId) ?? { canonicalId: n.canonicalId, categoryNames: [] };
    if (!entry.categoryNames.includes(n.categoryName)) entry.categoryNames.push(n.categoryName);
    noteMergedMap.set(n.canonicalId, entry);
  }
  const uniqueNoteMatches = Array.from(noteMergedMap.values());

  const totalFlags = conflicts.length + customWarningMatches.length + uniqueNoteMatches.length;
  if (totalFlags === 0) return null;

  // Design refresh (2026-11-25): neutral glass card with the amber hue
  // carried by the icon, a thin amber ring and a dot on each row — the old
  // yellow-tinted box and tinted rows were the pre-refresh look.
  const rowClass =
    "flex items-start gap-2.5 rounded-2xl border border-foreground/10 bg-surface/60 px-3 py-2.5 backdrop-blur-md";
  const dot = <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#f59e0b]" aria-hidden="true" />;

  return (
    <div
      className="mt-4 overflow-hidden rounded-[22px] border bg-surface/70 backdrop-blur-md"
      style={{ borderColor: "color-mix(in srgb, #f59e0b 40%, transparent)" }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border bg-surface/70"
          style={{ borderColor: "color-mix(in srgb, #f59e0b 35%, transparent)" }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" x2="12" y1="9" y2="13" />
            <line x1="12" x2="12.01" y1="17" y2="17" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {totalFlags} content {totalFlags === 1 ? "flag" : "flags"} for your settings
          </span>
          <span className="block text-xs text-muted">Outside your comfort zone</span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`flex-shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="space-y-1.5 px-3.5 pb-3.5">
          {conflicts.map((c) => (
            <div key={c.categoryName} className={rowClass}>
              {dot}
              <span className="min-w-0 text-xs">
                <span className="block font-semibold leading-snug text-foreground break-words">{c.categoryName}</span>
                <span className="block text-[11px] leading-snug text-muted break-words">
                  {INTENSITY_LABELS[c.bookIntensity] ?? "Present"} · your max is {TOLERANCE_LABELS[c.userMax] ?? "limited"}
                </span>
              </span>
            </div>
          ))}
          {customWarningMatches.map((m) => (
            <div key={m.canonicalId} className={rowClass}>
              {dot}
              <span className="min-w-0 text-xs">
                <span className="block font-semibold leading-snug text-foreground break-words">{getWarningLabel(m.canonicalId)}</span>
                <span className="block text-[11px] leading-snug text-muted break-words">
                  {m.count} {m.count === 1 ? "reviewer" : "reviewers"} flagged &middot; you asked to avoid
                </span>
              </span>
            </div>
          ))}
          {uniqueNoteMatches.map((m) => (
            <div key={m.canonicalId} className={rowClass}>
              {dot}
              <span className="min-w-0 text-xs">
                <span className="block font-semibold leading-snug text-foreground break-words">{getWarningLabel(m.canonicalId)}</span>
                <span className="block text-[11px] leading-snug text-muted break-words">
                  Noted in {m.categoryNames.join(", ")} &middot; you asked to avoid
                </span>
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              requestAnimationFrame(() => {
                const el = document.getElementById("whats-inside");
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              });
            }}
            className="mt-1 px-1 text-xs font-semibold read-more-link"
          >
            See all content details &darr;
          </button>
        </div>
      )}
    </div>
  );
}
