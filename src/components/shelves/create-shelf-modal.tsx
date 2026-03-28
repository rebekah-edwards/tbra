"use client";

import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { createShelf, updateShelf } from "@/lib/actions/shelves";

const COLOR_PRESETS = [
  { name: "Amber", value: null, preview: "#d97706" },
  { name: "Rose", value: "#f43f5e", preview: "#f43f5e" },
  { name: "Sky", value: "#38bdf8", preview: "#38bdf8" },
  { name: "Violet", value: "#8b5cf6", preview: "#8b5cf6" },
  { name: "Emerald", value: "#10b981", preview: "#10b981" },
  { name: "Slate", value: "#64748b", preview: "#64748b" },
  { name: "Coral", value: "#fb923c", preview: "#fb923c" },
  { name: "Fuchsia", value: "#d946ef", preview: "#d946ef" },
];

interface CreateShelfModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (slug: string) => void;
  /** Pass shelf data for edit mode */
  editShelf?: { id: string; name: string; description: string | null; color: string | null; isPublic: boolean };
  isPremium: boolean;
}

export function CreateShelfModal({ open, onClose, onCreated, editShelf, isPremium }: CreateShelfModalProps) {
  const [name, setName] = useState(editShelf?.name ?? "");
  const [description, setDescription] = useState(editShelf?.description ?? "");
  const [color, setColor] = useState<string | null>(editShelf?.color ?? null);
  const [isPublic, setIsPublic] = useState(editShelf?.isPublic ?? false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const isEdit = !!editShelf;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setError("");
    startTransition(async () => {
      if (isEdit) {
        const result = await updateShelf(editShelf!.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          isPublic,
        });
        if (result.success) {
          onClose();
          if (result.slug) onCreated?.(result.slug);
        } else {
          setError(result.error || "Failed to update shelf");
        }
      } else {
        const result = await createShelf(name.trim(), description.trim() || undefined, isPublic, color || undefined);
        if (result.success) {
          setName("");
          setDescription("");
          setColor(null);
          setIsPublic(false);
          onClose();
          if (result.slug) onCreated?.(result.slug);
        } else {
          setError(result.error || "Failed to create shelf");
        }
      }
    });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={isEdit ? "Edit Shelf" : "Create Shelf"}>
      <form onSubmit={handleSubmit} className="p-5 space-y-5">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Summer 2026 Reads"
            maxLength={100}
            className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent"
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1.5">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Books I want to read this summer..."
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent resize-none"
          />
        </div>

        {/* Color picker */}
        <div>
          <label className="block text-xs font-medium text-muted mb-2">Shelf Color</label>
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((preset) => {
              const isActive = preset.value === color;
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => setColor(preset.value)}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                    isActive
                      ? "ring-2 ring-offset-1 ring-offset-surface"
                      : "hover:scale-105"
                  }`}
                  style={{
                    background: `${preset.preview}20`,
                    color: preset.preview,
                    ...(isActive ? { ringColor: preset.preview } : {}),
                  }}
                  title={preset.name}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0"
                    style={{ background: preset.preview }}
                  />
                  {preset.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Public toggle */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-foreground">Share publicly</span>
            <p className="text-[11px] text-muted mt-0.5">Others can view and follow this shelf</p>
          </div>
          <button
            type="button"
            onClick={() => setIsPublic(!isPublic)}
            disabled={!isPremium}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              isPublic ? "bg-accent" : "bg-border"
            } ${!isPremium ? "opacity-50" : ""}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                isPublic ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="w-full rounded-xl bg-accent py-3 text-center text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50"
        >
          {pending ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save Changes" : "Create Shelf")}
        </button>
      </form>
    </BottomSheet>
  );
}
