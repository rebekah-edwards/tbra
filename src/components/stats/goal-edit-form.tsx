"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setReadingGoal } from "@/lib/actions/reading-goals";

/** Pencil for a goal card's corner (Stats reading goal). */
export function GoalEditButton({ onClick, label = "Edit goal" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="btn-glass h-8 w-8 flex-shrink-0 cursor-pointer text-muted hover:text-foreground"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    </button>
  );
}

/** Inline editor for the yearly books goal (same action as the Home tile). */
export function ReadingGoalEditForm({ target, year, onDone }: { target: number; year: number; onDone: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(String(target));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const fd = new FormData();
    fd.set("targetBooks", value);
    start(async () => {
      const r = await setReadingGoal(fd);
      if (!r.success) {
        setError(r.error ?? "Could not save the goal.");
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <p className="eyebrow">{year} goal</p>
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 3))}
          aria-label="Books goal"
          className="field-glass w-28 text-center text-lg font-bold"
        />
        <span className="text-sm text-muted">books this year</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="btn-glass cursor-pointer px-4 py-1.5 text-sm">Cancel</button>
        <button type="submit" disabled={pending || !value} className="btn-lime cursor-pointer px-5 py-1.5 text-sm">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
