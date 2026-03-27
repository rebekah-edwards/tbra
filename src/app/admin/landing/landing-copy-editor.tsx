"use client";

import { useState, useTransition } from "react";
import { updateLandingCopy } from "@/lib/actions/landing";

interface CopySection {
  sectionKey: string;
  sectionLabel: string;
  content: string;
}

export function LandingCopyEditor({ sections }: { sections: CopySection[] }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(sections.map((s) => [s.sectionKey, s.content]))
  );
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
    setSaved((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function handleSave(key: string) {
    startTransition(async () => {
      setSaving((prev) => new Set(prev).add(key));
      try {
        await updateLandingCopy(key, values[key]);
        setDirty((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setSaved((prev) => new Set(prev).add(key));
        setTimeout(() => setSaved((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        }), 2000);
      } catch (err) {
        alert("Failed to save: " + (err as Error).message);
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    });
  }

  function handleSaveAll() {
    for (const key of dirty) {
      handleSave(key);
    }
  }

  // Group sections by prefix
  const groups: { label: string; items: CopySection[] }[] = [];
  const groupMap = new Map<string, CopySection[]>();
  for (const s of sections) {
    const groupKey = s.sectionLabel.split(" — ")[0];
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
    groupMap.get(groupKey)!.push(s);
  }
  for (const [label, items] of groupMap) {
    groups.push({ label, items });
  }

  return (
    <div className="space-y-6">
      {dirty.size > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveAll}
            disabled={isPending}
            className="px-4 py-2 rounded-lg bg-accent text-black text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50"
          >
            {isPending ? "Saving..." : `Save All Changes (${dirty.size})`}
          </button>
          <span className="text-xs text-muted">{dirty.size} unsaved</span>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.label} className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">{group.label}</h3>
          {group.items.map((section) => {
            const isLong = section.content.length > 80 || section.sectionKey.includes("body") || section.sectionKey.includes("subhead");
            const fieldLabel = section.sectionLabel.includes(" — ")
              ? section.sectionLabel.split(" — ")[1]
              : section.sectionLabel;

            return (
              <div key={section.sectionKey} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted">{fieldLabel}</label>
                  <div className="flex items-center gap-2">
                    {saved.has(section.sectionKey) && (
                      <span className="text-xs text-accent">Saved!</span>
                    )}
                    {dirty.has(section.sectionKey) && (
                      <button
                        onClick={() => handleSave(section.sectionKey)}
                        disabled={saving.has(section.sectionKey)}
                        className="text-xs px-2 py-1 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
                      >
                        {saving.has(section.sectionKey) ? "..." : "Save"}
                      </button>
                    )}
                  </div>
                </div>
                {isLong ? (
                  <textarea
                    value={values[section.sectionKey] ?? ""}
                    onChange={(e) => handleChange(section.sectionKey, e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-surface-alt p-3 text-sm text-foreground resize-y"
                  />
                ) : (
                  <input
                    type="text"
                    value={values[section.sectionKey] ?? ""}
                    onChange={(e) => handleChange(section.sectionKey, e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-alt p-3 text-sm text-foreground"
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}

      <p className="text-xs text-muted">
        Use <code className="bg-surface-alt px-1 rounded">{"{count}"}</code> in the Book Parade heading to insert the live book count.
      </p>
    </div>
  );
}
