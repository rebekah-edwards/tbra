"use client";

import { useState, useTransition } from "react";
import { parseDbDate } from "@/lib/date-utils";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Correction = {
  id: string;
  status: string;
  message: string;
  proposedIntensity: number | null;
  proposedNotes: string | null;
  createdAt: string;
  bookId: string;
  bookTitle: string | null;
  bookSlug: string | null;
  userId: string | null;
  userEmail: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryKey: string | null;
  currentIntensity: number | null;
  currentNotes: string | null;
  currentEvidence: string | null;
};

type Props = {
  corrections: Correction[];
  counts: Record<string, number>;
  activeStatus: string;
};

const STATUS_TABS = [
  { key: "new", label: "New" },
  { key: "triaged", label: "Triaged" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
];

const INTENSITY_LABELS = ["None", "Mild", "Moderate", "Significant", "Extreme"];

// Content notes read best at 70-190 characters (short mobile labels).
const NOTE_MIN = 70;
const NOTE_MAX = 190;

const EVIDENCE_LABELS: Record<string, string> = {
  ai_inferred: "AI-inferred",
  cited: "Cited",
  human_verified: "Verified",
};

function IntensityBadge({ intensity }: { intensity: number | null }) {
  if (intensity === null) return <span className="text-muted text-xs italic">not specified</span>;
  const colors = [
    "bg-surface-alt text-muted",
    "bg-green-500/15 text-green-400",
    "bg-yellow-500/15 text-yellow-400",
    "bg-orange-500/15 text-orange-400",
    "bg-red-500/15 text-red-400",
  ];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colors[intensity] ?? "bg-surface-alt text-muted"}`}>
      {intensity} — {INTENSITY_LABELS[intensity] ?? "Unknown"}
    </span>
  );
}

/**
 * The submission message is usually auto-generated ("Reviewer proposed
 * intensity N for key; proposed note: …") and just repeats the proposed
 * fields. Only show it when the reader wrote something beyond that.
 */
function extraMessage(c: Correction): string | null {
  const msg = c.message?.trim();
  if (!msg) return null;
  if (/^Reviewer proposed intensity \d+ for /i.test(msg)) return null;
  if (c.proposedNotes && msg === c.proposedNotes.trim()) return null;
  return msg;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</p>
  );
}

function CorrectionCard({
  correction,
  onAction,
}: {
  correction: Correction;
  onAction: (id: string, action: "accept" | "reject" | "triage" | "delete") => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [draftNotes, setDraftNotes] = useState(correction.currentNotes ?? "");
  const [draftIntensity, setDraftIntensity] = useState<number>(
    correction.currentIntensity ?? correction.proposedIntensity ?? 0
  );
  const [error, setError] = useState<string | null>(null);

  const isOpen = correction.status === "new" || correction.status === "triaged";
  const hasCategory = !!correction.categoryId;
  const extra = extraMessage(correction);
  const readerNote = correction.proposedNotes?.trim() || null;
  const trimmedDraft = draftNotes.trim();
  const noteLength = trimmedDraft.length;
  const bookHref = correction.bookSlug
    ? `/book/${correction.bookSlug}`
    : `/book/${correction.bookId}`;

  function handleAction(action: "accept" | "reject" | "triage" | "delete") {
    startTransition(async () => {
      await onAction(correction.id, action);
    });
  }

  function saveAndVerify() {
    setError(null);
    if (hasCategory && !trimmedDraft) {
      setError("Add the final wording before saving.");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/corrections/${correction.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hasCategory ? { intensityOverride: draftIntensity, notesOverride: trimmedDraft } : {}
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Save failed. Try again.");
        return;
      }
      await onAction(correction.id, "accept");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-4 relative">
      {isPending && (
        <div className="absolute inset-0 rounded-xl bg-surface/70 flex items-center justify-center z-10">
          <span className="text-xs text-muted animate-pulse">Saving…</span>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={bookHref}
            className="text-sm font-semibold text-neon-blue hover:underline truncate block"
            target="_blank"
          >
            {correction.bookTitle ?? correction.bookId}
          </Link>
          <p className="text-xs text-muted mt-0.5">
            {correction.categoryName ? (
              <span className="font-medium text-foreground/80">{correction.categoryName}</span>
            ) : (
              <span className="italic">General feedback</span>
            )}
            {" · "}
            {correction.userEmail ?? "anonymous"}
            {" · "}
            {parseDbDate(correction.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <StatusBadge status={correction.status} />
      </div>

      {/* Reader's suggestion vs. the current entry */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-alt p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Reader suggests</SectionLabel>
            {hasCategory && <IntensityBadge intensity={correction.proposedIntensity} />}
          </div>
          {readerNote ? (
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">{readerNote}</p>
          ) : !extra ? (
            <p className="text-sm text-muted italic">No note given.</p>
          ) : null}
          {extra && (
            <p className="text-xs text-muted whitespace-pre-wrap">
              <span className="font-medium text-foreground/70">Message: </span>
              {extra}
            </p>
          )}
        </div>

        {hasCategory && (
          <div className="rounded-lg bg-surface-alt p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Current entry</SectionLabel>
              {correction.currentIntensity !== null && (
                <IntensityBadge intensity={correction.currentIntensity} />
              )}
            </div>
            {correction.currentIntensity === null ? (
              <p className="text-sm text-muted italic">No rating in this category yet.</p>
            ) : (
              <>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                  {correction.currentNotes?.trim() || <span className="text-muted italic">No text.</span>}
                </p>
                {correction.currentEvidence && (
                  <p className="text-[11px] text-muted">
                    {EVIDENCE_LABELS[correction.currentEvidence] ?? correction.currentEvidence}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Editor: final wording + strength */}
      {isOpen && hasCategory && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="space-y-1.5">
            <label htmlFor={`notes-${correction.id}`} className="block">
              <SectionLabel>Final wording</SectionLabel>
            </label>
            <textarea
              id={`notes-${correction.id}`}
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              rows={3}
              placeholder="Write the content note readers will see"
              className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <p className={`text-[11px] ${noteLength > 0 && (noteLength < NOTE_MIN || noteLength > NOTE_MAX) ? "text-orange-400" : "text-muted"}`}>
              {noteLength} characters · aim for {NOTE_MIN}–{NOTE_MAX}
            </p>
          </div>

          <div className="space-y-1.5">
            <SectionLabel>Strength</SectionLabel>
            <div className="grid grid-cols-5 gap-1.5">
              {[0, 1, 2, 3, 4].map((level) => {
                const selected = draftIntensity === level;
                const tags = [
                  correction.currentIntensity === level ? "current" : null,
                  correction.proposedIntensity === level ? "reader" : null,
                ].filter(Boolean);
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDraftIntensity(level)}
                    aria-pressed={selected}
                    className={`rounded-lg border-2 px-1 py-1.5 text-center transition-colors ${
                      selected
                        ? "border-accent bg-accent/15"
                        : "border-border bg-surface-alt hover:border-accent/40"
                    }`}
                  >
                    <span className={`block text-sm font-semibold ${selected ? "text-accent" : "text-foreground"}`}>
                      {level}
                    </span>
                    <span className="block text-[10px] text-muted leading-tight">
                      {INTENSITY_LABELS[level]}
                    </span>
                    <span className="block text-[9px] text-muted/70 leading-tight min-h-[11px]">
                      {tags.join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        {isOpen && (
          <button
            type="button"
            onClick={saveAndVerify}
            className="text-sm font-semibold text-neon-blue hover:underline"
          >
            {hasCategory ? "Save & Verify" : "Accept"}
          </button>
        )}
        {correction.status === "new" && (
          <button
            type="button"
            onClick={() => handleAction("triage")}
            className="text-xs font-medium text-muted hover:text-foreground"
          >
            Triage (flag for later)
          </button>
        )}
        {isOpen && (
          <button
            type="button"
            onClick={() => handleAction("reject")}
            className="text-xs font-medium text-destructive hover:underline"
          >
            Reject
          </button>
        )}
        {!isOpen && (
          <button
            type="button"
            onClick={() => handleAction("delete")}
            className="text-xs font-medium text-muted hover:text-destructive ml-auto"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    triaged: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    accepted: "bg-green-500/15 text-green-400 border-green-500/20",
    rejected: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${styles[status] ?? "bg-surface-alt text-muted border-border"}`}>
      {status}
    </span>
  );
}

export function CorrectionsTriageDashboard({
  corrections: initialCorrections,
  counts: initialCounts,
  activeStatus,
}: Props) {
  const router = useRouter();
  const [corrections, setCorrections] = useState(initialCorrections);
  const [counts, setCounts] = useState(initialCounts);

  function navigateToStatus(status: string) {
    router.push(`/admin/corrections?status=${status}`);
  }

  async function handleAction(
    id: string,
    action: "accept" | "reject" | "triage" | "delete"
  ): Promise<void> {
    if (action === "delete") {
      await fetch(`/api/admin/corrections/${id}`, { method: "DELETE" });
      setCorrections((prev) => prev.filter((c) => c.id !== id));
      setCounts((prev) => ({
        ...prev,
        [activeStatus]: Math.max(0, (prev[activeStatus] ?? 0) - 1),
      }));
      return;
    }

    const statusMap = {
      accept: "accepted",
      reject: "rejected",
      triage: "triaged",
    } as const;

    const newStatus = statusMap[action];

    // Note: "accept" with categoryId is handled via the /apply sub-route directly in the card
    // Here we handle the simple status-update cases (triage, reject, no-category accept)
    if (action !== "accept") {
      await fetch(`/api/admin/corrections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    }

    // Remove from current list (moved to another status bucket)
    setCorrections((prev) => prev.filter((c) => c.id !== id));
    setCounts((prev) => ({
      ...prev,
      [activeStatus]: Math.max(0, (prev[activeStatus] ?? 0) - 1),
      [newStatus]: (prev[newStatus] ?? 0) + 1,
    }));
  }

  return (
    <div className="space-y-4">
      {/* Status tabs */}
      <div className="flex gap-1 rounded-xl bg-surface-alt p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => navigateToStatus(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              activeStatus === tab.key
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {(counts[tab.key] ?? 0) > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                activeStatus === tab.key
                  ? "bg-accent/20 text-accent"
                  : "bg-border text-muted"
              }`}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {corrections.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">
            No {activeStatus} corrections.{" "}
            {activeStatus === "new" && "You're all caught up! 🎉"}
          </p>
        </div>
      )}

      {/* Correction cards */}
      <div className="space-y-3">
        {corrections.map((correction) => (
          <CorrectionCard
            key={correction.id}
            correction={correction}
            onAction={handleAction}
          />
        ))}
      </div>
    </div>
  );
}
