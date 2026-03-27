"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setReadingGoal } from "@/lib/actions/reading-goals";

interface ReadingGoalCardProps {
  goal: { targetBooks: number; completedBooks: number; percentComplete: number } | null;
  year: number;
}

export function ReadingGoalCard({ goal, year }: ReadingGoalCardProps) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(goal?.targetBooks?.toString() ?? "24");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    const formData = new FormData();
    formData.set("targetBooks", target);
    startTransition(async () => {
      const result = await setReadingGoal(formData);
      if (result.success) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (editing || !goal) {
    return (
      <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-surface to-surface-alt p-4 lg:px-6">
        <p className="text-xs font-medium text-muted mb-2">
          {goal ? `${year} Reading Goal` : `Set a ${year} reading goal`}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max="500"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-20 rounded-lg border border-border bg-surface-alt px-3 py-2 text-center text-lg font-bold"
          />
          <span className="text-sm text-muted">books</span>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save"}
          </button>
          {goal && (
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  const circumference = 2 * Math.PI * 36;
  const dashOffset = circumference - (goal.percentComplete / 100) * circumference;

  return (
    <div className="relative rounded-xl border border-primary/20 bg-gradient-to-br from-surface to-surface-alt p-4 lg:px-6 hover:border-primary/40 transition-colors">
      {/* Edit icon button */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }}
        className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
        title="Edit goal"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      </button>

      {/* Tappable card body → links to completed books */}
      <Link
        href={`/library?tab=activity&filter=completed&year=${year}`}
        className="block"
      >
        <p className="text-xs font-medium text-muted mb-2">{year} Reading Goal</p>
        <div className="flex items-center gap-4">
          {/* Circular progress */}
          <div className="relative h-16 w-16 flex-shrink-0">
            <svg className="h-16 w-16 -rotate-90" viewBox="0 0 80 80">
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className="text-surface-alt"
              />
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                className="text-primary transition-all duration-500"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
              {goal.percentComplete}%
            </span>
          </div>
          <div>
            <p className="text-lg font-bold font-heading">
              {goal.completedBooks} <span className="text-sm font-normal text-muted">/ {goal.targetBooks}</span>
            </p>
            <p className="text-xs text-muted">books read</p>
          </div>
        </div>
      </Link>
    </div>
  );
}
