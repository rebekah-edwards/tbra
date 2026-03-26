"use client";

import { useState, useTransition } from "react";
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
  userId: string | null;
  userEmail: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryKey: string | null;
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

const INTENSITY_LABELS = ["None", "Mild", "Moderate", "Strong", "Extreme"];

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

function CorrectionCard({
  correction,
  onAction,
}: {
  correction: Correction;
  onAction: (id: string, action: "accept" | "reject" | "triage" | "delete") => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [applyIntensity, setApplyIntensity] = useState<number>(
    correction.proposedIntensity ?? 0
  );
  const [showApplyForm, setShowApplyForm] = useState(false);

  function handleAction(action: "accept" | "reject" | "triage" | "delete") {
    startTransition(async () => {
      await onAction(correction.id, action);
    });
  }

  async function handleApply() {
    if (!correction.categoryId) {
      // No category — call /apply which will mark accepted without writing rating
      const res = await fetch(`/api/admin/corrections/${correction.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        onAction(correction.id, "accept");
      }
      return;
    }
    setShowApplyForm(true);
  }

  async function submitApply() {
    const res = await fetch(`/api/admin/corrections/${correction.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intensityOverride: applyIntensity }),
    });
    if (res.ok) {
      onAction(correction.id, "accept");
    }
  }

  const isNew = correction.status === "new";
  const isTriaged = correction.status === "triaged";
  const isPending_ = isPending;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-3 relative">
      {isPending_ && (
        <div className="absolute inset-0 rounded-xl bg-surface/70 flex items-center justify-center z-10">
          <span className="text-xs text-muted animate-pulse">Saving…</span>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/book/${correction.bookId}`}
            className="text-sm font-semibold text-link hover:underline truncate block"
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
            {new Date(correction.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        {/* Status badge */}
        <StatusBadge status={correction.status} />
      </div>

      {/* Proposed intensity */}
      {correction.categoryId && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Proposed:</span>
          <IntensityBadge intensity={correction.proposedIntensity} />
        </div>
      )}

      {/* Message */}
      <blockquote className="text-sm text-foreground/90 border-l-2 border-primary/40 pl-3 italic">
        {correction.message}
      </blockquote>

      {/* Apply form (inline intensity picker before applying) */}
      {showApplyForm && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
          <p className="text-xs font-medium text-foreground">
            Apply intensity to <em>{correction.categoryName}</em>:
          </p>
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setApplyIntensity(level)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium border-2 transition-all ${
                  applyIntensity === level
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-surface-alt text-muted hover:border-primary/30"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={submitApply}
              className="flex-1 rounded-lg bg-primary py-2 text-xs font-semibold text-background"
            >
              ✓ Apply & Accept
            </button>
            <button
              onClick={() => setShowApplyForm(false)}
              className="px-3 rounded-lg border border-border text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!showApplyForm && (
        <div className="flex flex-wrap gap-2 pt-1">
          {(isNew || isTriaged) && (
            <button
              onClick={handleApply}
              className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              {correction.categoryId ? "Accept & Apply" : "Accept"}
            </button>
          )}
          {isNew && (
            <button
              onClick={() => handleAction("triage")}
              className="rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
            >
              Triage (flag for later)
            </button>
          )}
          {(isNew || isTriaged) && (
            <button
              onClick={() => handleAction("reject")}
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
            >
              Reject
            </button>
          )}
          {!isNew && (
            <button
              onClick={() => handleAction("delete")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-destructive transition-colors ml-auto"
            >
              Delete
            </button>
          )}
        </div>
      )}
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
                  ? "bg-primary/20 text-primary"
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
