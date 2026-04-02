"use client";

import { useState, useTransition } from "react";
import { setParentSeries, searchSeriesForParent } from "@/lib/actions/series";

interface FranchiseAdminControlsProps {
  seriesId: string;
  seriesName: string;
  currentParentId?: string | null;
  currentParentName?: string | null;
}

export function FranchiseAdminControls({
  seriesId,
  seriesName,
  currentParentId,
  currentParentName,
}: FranchiseAdminControlsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; slug: string | null }[]>([]);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function handleSearch(q: string) {
    setQuery(q);
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const res = await searchSeriesForParent(q);
    setResults(res.filter((r) => r.id !== seriesId));
  }

  function handleAssign(parentId: string, parentName: string) {
    startTransition(async () => {
      const res = await setParentSeries(seriesId, parentId);
      if (res.success) {
        setMessage("Assigned to " + parentName);
        setOpen(false);
      } else {
        setMessage("Error: " + (res.error || "unknown"));
      }
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const res = await setParentSeries(seriesId, null);
      if (res.success) {
        setMessage("Removed from franchise");
        setOpen(false);
      } else {
        setMessage("Error: " + (res.error || "unknown"));
      }
    });
  }

  return (
    <div className="mt-4">
      {message && (
        <p className="text-xs text-accent mb-2">{message}</p>
      )}

      {currentParentId ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Part of: {currentParentName}</span>
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="text-xs text-neon-blue hover:text-neon-blue/80 transition-colors"
        >
          {open ? "Cancel" : "Assign to franchise"}
        </button>
      )}

      {open && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            placeholder="Search franchise..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {results.length > 0 && (
            <div className="space-y-1">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleAssign(r.id, r.name)}
                  disabled={isPending}
                  className="w-full text-left rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm hover:border-accent/40 transition-colors disabled:opacity-50"
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
