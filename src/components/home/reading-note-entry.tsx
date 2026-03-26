"use client";

import { useState, useTransition } from "react";
import { addReadingNote } from "@/lib/actions/reading-notes";

interface ReadingNoteEntryProps {
  books: { id: string; title: string }[];
}

const MOODS = [
  { key: "excited", emoji: "🤩", label: "Excited" },
  { key: "tense", emoji: "😰", label: "Tense" },
  { key: "emotional", emoji: "🥺", label: "Emotional" },
  { key: "bored", emoji: "😴", label: "Bored" },
  { key: "relaxed", emoji: "😌", label: "Relaxed" },
  { key: "curious", emoji: "🤔", label: "Curious" },
  { key: "confused", emoji: "😵‍💫", label: "Confused" },
  { key: "nostalgic", emoji: "🥹", label: "Nostalgic" },
];

const PACES = [
  { key: "slow", label: "Slow" },
  { key: "steady", label: "Steady" },
  { key: "fast", label: "Fast" },
  { key: "flying", label: "Flying" },
];

export function ReadingNoteEntry({ books }: ReadingNoteEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedBook, setSelectedBook] = useState(books[0]?.id ?? "");
  const [noteText, setNoteText] = useState("");
  const [pageMode, setPageMode] = useState<"page" | "percent">("page");
  const [pageValue, setPageValue] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [pace, setPace] = useState<string | null>(null);
  const [showExtras, setShowExtras] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    if (!noteText.trim()) return;
    const formData = new FormData();
    formData.set("bookId", selectedBook);
    formData.set("noteText", noteText.trim());
    if (pageValue) {
      if (pageMode === "page") {
        formData.set("pageNumber", pageValue);
      } else {
        formData.set("percentComplete", pageValue);
      }
    }
    if (mood) formData.set("mood", mood);
    if (pace) formData.set("pace", pace);

    startTransition(async () => {
      const result = await addReadingNote(formData);
      if (result.success) {
        setSuccess(true);
        setNoteText("");
        setPageValue("");
        setMood(null);
        setPace(null);
        setShowExtras(false);
        setTimeout(() => {
          setSuccess(false);
          setExpanded(false);
        }, 2000);
      }
    });
  }

  if (success) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
        <p className="text-sm text-primary font-medium">✓ Note saved</p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full rounded-xl border border-border bg-surface p-3 text-left text-sm text-muted hover:border-primary/30 transition-colors"
      >
        📝 How&apos;s the read going?
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3 space-y-3">
      {/* Book selector (if multiple) */}
      {books.length > 1 && (
        <select
          value={selectedBook}
          onChange={(e) => setSelectedBook(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-xs"
        >
          {books.map((b) => (
            <option key={b.id} value={b.id}>{b.title}</option>
          ))}
        </select>
      )}

      {/* Note text */}
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="What are you thinking about the book so far?"
        rows={2}
        maxLength={2000}
        className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm placeholder:text-muted resize-none"
        autoFocus
      />

      {/* Page / % tracker */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setPageMode("page")}
            className={`px-2.5 py-1 ${pageMode === "page" ? "bg-primary text-background" : "text-muted"}`}
          >
            Page
          </button>
          <button
            onClick={() => setPageMode("percent")}
            className={`px-2.5 py-1 ${pageMode === "percent" ? "bg-primary text-background" : "text-muted"}`}
          >
            %
          </button>
        </div>
        <input
          type="number"
          min="0"
          max={pageMode === "percent" ? 100 : 99999}
          value={pageValue}
          onChange={(e) => setPageValue(e.target.value)}
          placeholder={pageMode === "page" ? "Page #" : "0-100"}
          className="w-20 rounded-lg border border-border bg-surface-alt px-2 py-1 text-xs text-center"
        />
        <button
          onClick={() => setShowExtras(!showExtras)}
          className="ml-auto text-xs text-muted hover:text-foreground transition-colors"
        >
          {showExtras ? "Less" : "Mood & pace"}
        </button>
      </div>

      {/* Expandable mood + pace */}
      {showExtras && (
        <div className="space-y-2">
          {/* Mood */}
          <div className="flex flex-wrap gap-1.5">
            {MOODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMood(mood === m.key ? null : m.key)}
                className={`rounded-full px-2.5 py-1 text-xs transition-all ${
                  mood === m.key
                    ? "bg-neon-purple/20 text-neon-purple border border-neon-purple/30"
                    : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
                }`}
              >
                {m.emoji} {m.label}
              </button>
            ))}
          </div>

          {/* Pace */}
          <div className="flex gap-1.5">
            {PACES.map((p) => (
              <button
                key={p.key}
                onClick={() => setPace(pace === p.key ? null : p.key)}
                className={`rounded-full px-3 py-1 text-xs transition-all ${
                  pace === p.key
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "bg-surface-alt text-muted border border-transparent hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={isPending || !noteText.trim()}
          className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save Note"}
        </button>
        <button
          onClick={() => { setExpanded(false); setNoteText(""); setMood(null); setPace(null); setShowExtras(false); }}
          className="text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
