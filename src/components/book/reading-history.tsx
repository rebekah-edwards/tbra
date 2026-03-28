"use client";

import { useState, useTransition } from "react";
import {
  updateReadingSession,
  addRereadSession,
  deleteReadingSession,
} from "@/lib/actions/reading-session";
import type { ReadingSession } from "@/lib/queries/reading-session";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  // Handle ISO datetime strings — extract date part
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const parts = datePart.split("-");
  if (parts.length !== 3) return "";
  const [y, m, d] = parts;
  const year = Number(y);
  // Reject clearly invalid years
  if (isNaN(year) || year < 1900 || year > 2100) return "";
  const date = new Date(year, Number(m) - 1, Number(d));
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toInputDate(dateStr: string | null): string {
  if (!dateStr) return "";
  // Handle ISO datetime — extract date part
  if (dateStr.includes("T")) return dateStr.split("T")[0];
  return dateStr;
}

interface ReadingHistoryProps {
  sessions: ReadingSession[];
  bookId: string;
}

function SessionRow({
  session: initialSession,
  onUpdate,
}: {
  session: ReadingSession;
  onUpdate: () => void;
}) {
  // Optimistic local state so UI updates instantly
  const [session, setSession] = useState(initialSession);
  const [editingStart, setEditingStart] = useState(false);
  const [editingPaused, setEditingPaused] = useState(false);
  const [editingEnd, setEditingEnd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDateChange(
    field: "startedAt" | "completionDate" | "pausedAt",
    value: string
  ) {
    // Optimistically update local state immediately
    setSession((prev) => ({ ...prev, [field]: value || null }));
    if (field === "startedAt") setEditingStart(false);
    if (field === "pausedAt") setEditingPaused(false);
    if (field === "completionDate") setEditingEnd(false);

    // Save to server in background
    startTransition(async () => {
      await updateReadingSession(session.id, {
        [field]: !value ? null : value,
      });
      onUpdate();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteReadingSession(session.id);
      onUpdate();
    });
  }

  const stateLabel =
    session.state === "completed"
      ? "Finished"
      : session.state === "currently_reading"
        ? "Reading"
        : session.state === "paused"
          ? "Paused"
          : session.state === "dnf"
            ? "DNF"
            : session.state;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-border/50 bg-surface px-3 py-2.5 text-sm transition-opacity ${isPending ? "opacity-50" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground">
            Read #{session.readNumber}
          </span>
          <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs text-muted">
            {stateLabel}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-1 text-xs text-muted flex-wrap">
          {/* Start date */}
          {editingStart ? (
            <input
              type="date"
              defaultValue={toInputDate(session.startedAt)}
              onBlur={(e) => {
                const val = e.target.value;
                if (val && val !== toInputDate(session.startedAt)) {
                  handleDateChange("startedAt", val);
                } else {
                  setEditingStart(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingStart(false);
              }}
              autoFocus
              className="rounded border border-border bg-surface-alt px-1.5 py-0.5 text-xs text-foreground"
            />
          ) : (
            <button
              onClick={() => setEditingStart(true)}
              className="hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
              title="Edit start date"
            >
              {formatDate(session.startedAt) || "No start date"}
            </button>
          )}

          <span className="text-muted/50 mx-0.5">&rarr;</span>

          {/* Paused date — only show when session is paused */}
          {session.state === "paused" && (
            <>
              {editingPaused ? (
                <input
                  type="date"
                  defaultValue={toInputDate(session.pausedAt)}
                  onBlur={(e) => {
                    const val = e.target.value;
                    if (val !== toInputDate(session.pausedAt)) {
                      handleDateChange("pausedAt", val || "");
                    } else {
                      setEditingPaused(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingPaused(false);
                  }}
                  autoFocus
                  className="rounded border border-border bg-surface-alt px-1.5 py-0.5 text-xs text-foreground"
                />
              ) : (
                <button
                  onClick={() => setEditingPaused(true)}
                  className="hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                  title="Edit paused date"
                >
                  {formatDate(session.pausedAt) || "No paused date"}
                </button>
              )}
              <span className="text-muted/50 mx-0.5">&rarr;</span>
            </>
          )}

          {/* End date */}
          {editingEnd ? (
            <input
              type="date"
              defaultValue={toInputDate(session.completionDate)}
              onBlur={(e) => {
                const val = e.target.value;
                if (val !== toInputDate(session.completionDate)) {
                  handleDateChange("completionDate", val || "");
                } else {
                  setEditingEnd(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingEnd(false);
              }}
              autoFocus
              className="rounded border border-border bg-surface-alt px-1.5 py-0.5 text-xs text-foreground"
            />
          ) : (
            <button
              onClick={() => setEditingEnd(true)}
              className="hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
              title="Edit finish date"
            >
              {formatDate(session.completionDate) || "No finish date"}
            </button>
          )}
        </div>
      </div>

      {/* Delete */}
      <div className="flex-shrink-0">
        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded px-2 py-0.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded p-1 text-muted/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete session"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export function ReadingHistory({ sessions, bookId }: ReadingHistoryProps) {
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  // Force re-render after mutations (revalidatePath handles data)
  const [, setKey] = useState(0);
  function onUpdate() {
    setKey((k) => k + 1);
  }

  function handleAddReread() {
    startTransition(async () => {
      await addRereadSession(bookId, {
        startedAt: newStart || undefined,
        completionDate: newEnd || null,
      });
      setShowAddForm(false);
      setNewStart("");
      setNewEnd("");
      onUpdate();
    });
  }

  if (sessions.length === 0) {
    return null;
  }

  return (
    <section className="mt-8 space-y-3 px-4 lg:px-0">
      <h2 className="section-heading text-lg">Reading History</h2>

      <div className="space-y-2">
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} onUpdate={onUpdate} />
        ))}
      </div>

      {/* Add re-read */}
      {showAddForm ? (
        <div
          className={`rounded-lg border border-neon-blue/30 bg-neon-blue/5 p-3 space-y-3 ${isPending ? "opacity-50" : ""}`}
        >
          <p className="text-sm font-medium text-foreground">Add a re-read</p>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-muted">
              Started
              <input
                type="date"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="ml-1.5 rounded border border-border bg-surface-alt px-2 py-1 text-xs text-foreground"
              />
            </label>
            <label className="text-xs text-muted">
              Finished
              <input
                type="date"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="ml-1.5 rounded border border-border bg-surface-alt px-2 py-1 text-xs text-foreground"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddReread}
              disabled={isPending}
              className="rounded-lg bg-neon-blue/20 px-3 py-1.5 text-xs font-medium text-neon-blue hover:bg-neon-blue/30 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewStart("");
                setNewEnd("");
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="rounded-lg border border-neon-blue/30 bg-neon-blue/10 px-3 py-1.5 text-xs font-medium text-neon-blue hover:bg-neon-blue/20 transition-colors"
        >
          + Add re-read
        </button>
      )}
    </section>
  );
}
