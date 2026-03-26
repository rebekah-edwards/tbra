"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resolveIssue, deleteIssue } from "@/lib/actions/issues";

type Issue = {
  id: string;
  status: string;
  description: string;
  pageUrl: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  bookId: string | null;
  bookTitle: string | null;
  seriesId: string | null;
  seriesName: string | null;
  userId: string;
  userEmail: string | null;
};

type Props = {
  issues: Issue[];
  counts: Record<string, number>;
  activeStatus: string;
};

const STATUS_TABS = [
  { key: "new", label: "New" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "wontfix", label: "Won't Fix" },
];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    in_progress: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    resolved: "bg-green-500/15 text-green-400 border-green-500/20",
    wontfix: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  const labels: Record<string, string> = {
    new: "new",
    in_progress: "in progress",
    resolved: "resolved",
    wontfix: "won't fix",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${styles[status] ?? "bg-surface-alt text-muted border-border"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function IssueCard({
  issue,
  onAction,
}: {
  issue: Issue;
  onAction: (id: string, action: "in_progress" | "resolved" | "wontfix" | "delete", resolution?: string) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [resolutionText, setResolutionText] = useState("");

  function handleAction(action: "in_progress" | "wontfix" | "delete") {
    startTransition(async () => {
      await onAction(issue.id, action);
    });
  }

  function handleResolve() {
    startTransition(async () => {
      await onAction(issue.id, "resolved", resolutionText.trim() || undefined);
      setShowResolveForm(false);
      setResolutionText("");
    });
  }

  const isNew = issue.status === "new";
  const isInProgress = issue.status === "in_progress";

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-3 relative">
      {isPending && (
        <div className="absolute inset-0 rounded-xl bg-surface/70 flex items-center justify-center z-10">
          <span className="text-xs text-muted animate-pulse">Saving...</span>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {issue.bookId ? (
            <Link
              href={`/book/${issue.bookId}`}
              className="text-sm font-semibold text-link hover:underline truncate block"
              target="_blank"
            >
              {issue.bookTitle ?? issue.bookId}
            </Link>
          ) : (
            <span className="text-sm font-semibold text-foreground/80 italic">
              General issue
            </span>
          )}
          <p className="text-xs text-muted mt-0.5">
            {issue.seriesName && (
              <>
                <span className="font-medium text-foreground/80">{issue.seriesName}</span>
                {" · "}
              </>
            )}
            {issue.userEmail ?? "anonymous"}
            {" · "}
            {new Date(issue.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        <StatusBadge status={issue.status} />
      </div>

      {/* Description */}
      <blockquote className="text-sm text-foreground/90 border-l-2 border-primary/40 pl-3 italic">
        {issue.description}
      </blockquote>

      {/* Resolution (if resolved) */}
      {issue.resolution && (
        <div className="rounded-lg bg-surface-alt px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">Resolution</p>
          <p className="text-sm text-foreground/80">{issue.resolution}</p>
        </div>
      )}

      {/* Resolve form */}
      {showResolveForm && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
          <p className="text-xs font-medium text-foreground">Resolution notes (optional):</p>
          <textarea
            value={resolutionText}
            onChange={(e) => setResolutionText(e.target.value)}
            placeholder="What was done to resolve this issue..."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none resize-none"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={handleResolve}
              className="flex-1 rounded-lg bg-primary py-2 text-xs font-semibold text-background"
            >
              Resolve
            </button>
            <button
              onClick={() => setShowResolveForm(false)}
              className="px-3 rounded-lg border border-border text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!showResolveForm && (
        <div className="flex flex-wrap gap-2 pt-1">
          {isNew && (
            <button
              onClick={() => handleAction("in_progress")}
              className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/20 transition-colors"
            >
              Mark In Progress
            </button>
          )}
          {(isNew || isInProgress) && (
            <button
              onClick={() => setShowResolveForm(true)}
              className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              Resolve
            </button>
          )}
          {(isNew || isInProgress) && (
            <button
              onClick={() => handleAction("wontfix")}
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
            >
              Won&apos;t Fix
            </button>
          )}
          <button
            onClick={() => handleAction("delete")}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-destructive transition-colors ml-auto"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function IssuesTriageDashboard({
  issues: initialIssues,
  counts: initialCounts,
  activeStatus,
}: Props) {
  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [counts, setCounts] = useState(initialCounts);

  // Sync state when server re-renders with new props (tab change)
  const [prevStatus, setPrevStatus] = useState(activeStatus);
  if (activeStatus !== prevStatus) {
    setPrevStatus(activeStatus);
    setIssues(initialIssues);
    setCounts(initialCounts);
  }

  function navigateToStatus(status: string) {
    router.push(`/admin/issues?status=${status}`);
  }

  async function handleAction(
    id: string,
    action: "in_progress" | "resolved" | "wontfix" | "delete",
    resolution?: string,
  ): Promise<void> {
    if (action === "delete") {
      const result = await deleteIssue(id);
      if (!result.success) return;
      setIssues((prev) => prev.filter((i) => i.id !== id));
      setCounts((prev) => ({
        ...prev,
        [activeStatus]: Math.max(0, (prev[activeStatus] ?? 0) - 1),
      }));
      return;
    }

    const result = await resolveIssue(id, action, resolution);
    if (!result.success) return;

    // Remove from current list (moved to another status bucket)
    setIssues((prev) => prev.filter((i) => i.id !== id));
    setCounts((prev) => ({
      ...prev,
      [activeStatus]: Math.max(0, (prev[activeStatus] ?? 0) - 1),
      [action]: (prev[action] ?? 0) + 1,
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
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  activeStatus === tab.key
                    ? "bg-primary/20 text-primary"
                    : "bg-border text-muted"
                }`}
              >
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {issues.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">
            No {activeStatus === "wontfix" ? "won't fix" : activeStatus.replace("_", " ")} issues.{" "}
            {activeStatus === "new" && "All clear!"}
          </p>
        </div>
      )}

      {/* Issue cards */}
      <div className="space-y-3">
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            onAction={handleAction}
          />
        ))}
      </div>
    </div>
  );
}
