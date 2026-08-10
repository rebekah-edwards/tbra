"use client";

import { useEffect, useState, useCallback } from "react";
import { BLOCKED_CW_KEYWORDS } from "@/lib/review-constants";
import type { ProposedCorrection } from "../review-wizard";

interface CategoryRating {
  categoryKey: string;
  categoryName: string;
  intensity: number | null; // 0-4, or null if not rated
  notes: string | null;
}

interface StepContentDetailsProps {
  bookId: string;
  proposedCorrections: Record<string, ProposedCorrection>;
  userAddedWarnings: string;
  onProposalChange: (categoryKey: string, proposal: ProposedCorrection | null) => void;
  onUserAddedWarningsChange: (text: string) => void;
}

const INTENSITY_LABELS = ["None", "Mild", "Moderate", "Significant", "Extreme"] as const;
const MAX_USER_ADDED_LENGTH = 300;

/**
 * Build the proposal for a category, or null when nothing actually differs
 * from what the book already says. Either half can be the change: a different
 * intensity, edited copy, or both. A copy-only edit still carries the current
 * intensity so the payload always has one.
 */
function buildProposal(
  current: { intensity: number | null; notes: string | null },
  nextIntensity: number | null,
  nextNote: string
): ProposedCorrection | null {
  const intensityChanged = nextIntensity !== null && nextIntensity !== current.intensity;
  const noteChanged = nextNote.trim() !== (current.notes ?? "").trim();
  if (!intensityChanged && !noteChanged) return null;
  return { intensity: nextIntensity ?? current.intensity, note: nextNote };
}

function containsBlocked(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_CW_KEYWORDS.some((kw) => lower.includes(kw));
}

export function StepContentDetails({
  bookId,
  proposedCorrections,
  userAddedWarnings,
  onProposalChange,
  onUserAddedWarningsChange,
}: StepContentDetailsProps) {
  const [ratings, setRatings] = useState<CategoryRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [blockedHint, setBlockedHint] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/book/${bookId}/content-ratings`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { ratings: [] }))
      .then((data) => {
        if (active) {
          setRatings((data.ratings ?? []).filter((r: CategoryRating) => r.categoryKey !== "other"));
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  const handleUserAddedChange = useCallback(
    (value: string) => {
      if (value.length > MAX_USER_ADDED_LENGTH) return;
      if (containsBlocked(value)) {
        setBlockedHint(true);
        return;
      }
      setBlockedHint(false);
      onUserAddedWarningsChange(value);
    },
    [onUserAddedWarningsChange],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <h2 className="font-heading text-xl font-bold text-center pb-1 px-4">
        What&apos;s in this book?
      </h2>
      <p className="text-xs text-muted text-center pb-4 px-4">
        Tap any category to suggest a different intensity or edit its note.
        Your proposal goes to a reviewer before it changes the book page.
      </p>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="text-center text-sm text-muted py-8">Loading current ratings…</div>
        ) : (
          <ul className="space-y-2">
            {ratings.map((r) => {
              const proposal = proposedCorrections[r.categoryKey];
              const proposedIntensity = proposal?.intensity ?? null;
              const isExpanded = expandedCategory === r.categoryKey;
              const currentLabel =
                r.intensity === null ? "Not rated" : INTENSITY_LABELS[r.intensity];
              return (
                <li
                  key={r.categoryKey}
                  className={`rounded-xl border transition-colors ${
                    proposal ? "border-purple-400/60 bg-purple-500/5" : "border-border bg-surface-alt/30"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedCategory(isExpanded ? null : r.categoryKey)
                    }
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {r.categoryName}
                      </p>
                      <p className="text-xs text-muted">
                        Current: {currentLabel}
                        {proposal && (
                          <span className="ml-2 text-purple-400">
                            → proposed: {proposedIntensity === null ? "—" : INTENSITY_LABELS[proposedIntensity]}
                          </span>
                        )}
                      </p>
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`text-muted/60 transition-transform flex-shrink-0 ml-2 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-border/60">
                      <div className="pt-3">
                        <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">
                          Suggest a different intensity
                        </p>
                        <div className="grid grid-cols-5 gap-1.5">
                          {INTENSITY_LABELS.map((label, i) => {
                            const selected = proposedIntensity === i;
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() =>
                                  onProposalChange(
                                    r.categoryKey,
                                    buildProposal(r, i, proposal?.note ?? r.notes ?? "")
                                  )
                                }
                                className={`rounded-lg px-1 py-1.5 text-[11px] font-medium transition-all ${
                                  selected
                                    ? "bg-purple-500/25 border-2 border-purple-400 text-purple-200"
                                    : "border border-border bg-background text-foreground/70 hover:border-purple-400/60"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">
                          Content note
                        </p>
                        {/* Seeded with the note currently shown on the book so
                            a reader can tweak the existing wording instead of
                            writing from scratch. On accept, the admin apply
                            route writes this straight into
                            book_category_ratings.notes — it IS the public copy,
                            not a private rationale. */}
                        <textarea
                          rows={3}
                          value={proposal?.note ?? r.notes ?? ""}
                          onChange={(e) =>
                            onProposalChange(
                              r.categoryKey,
                              buildProposal(r, proposedIntensity, e.target.value)
                            )
                          }
                          placeholder="Describe what's in the book for this category."
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-purple-400 focus:outline-none resize-none"
                        />
                        <p className="mt-1 text-[10px] text-muted/70">
                          Edits go to the admin review queue — they don&apos;t change the book right away.
                        </p>
                      </div>

                      {proposal && (
                        <button
                          type="button"
                          onClick={() => onProposalChange(r.categoryKey, null)}
                          className="text-xs text-muted hover:text-foreground transition-colors"
                        >
                          Cancel proposal
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* User-added trigger warnings section */}
        <div className="mt-6 rounded-xl border-2 border-dashed border-purple-500/30 bg-surface-alt/30 p-4">
          <p className="text-sm font-medium text-foreground mb-1">
            Add a trigger warning that isn&apos;t listed above
          </p>
          <p className="text-xs text-muted mb-3">
            e.g. eating disorders, religious trauma, medical content.
            One per line. Will be shared with a reviewer before appearing
            on the book page.
          </p>
          <textarea
            rows={3}
            value={userAddedWarnings}
            onChange={(e) => handleUserAddedChange(e.target.value)}
            placeholder={"Eating disorders\nReligious trauma"}
            maxLength={MAX_USER_ADDED_LENGTH}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-purple-400 focus:outline-none resize-none"
          />
          <div className="flex justify-between items-center mt-1">
            {blockedHint ? (
              <p className="text-xs text-destructive">That content isn&apos;t allowed</p>
            ) : (
              <div />
            )}
            <p className="text-[11px] text-muted">
              {userAddedWarnings.length}/{MAX_USER_ADDED_LENGTH}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
