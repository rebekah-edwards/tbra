"use client";

import { useState, useEffect } from "react";

export type TextSize = "small" | "medium" | "large";

const TEXT_SIZE_KEY = "tbra-text-size";

function applyTextSize(size: TextSize) {
  document.documentElement.setAttribute("data-text-size", size);
}

export function getStoredTextSize(): TextSize {
  if (typeof window === "undefined") return "medium";
  return (localStorage.getItem(TEXT_SIZE_KEY) as TextSize) || "medium";
}

export function TextSizeSelector() {
  const [size, setSize] = useState<TextSize>("medium");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = getStoredTextSize();
    setSize(stored);
    applyTextSize(stored);
  }, []);

  async function handleChange(newSize: TextSize) {
    setSize(newSize);
    localStorage.setItem(TEXT_SIZE_KEY, newSize);
    applyTextSize(newSize);

    // Persist to server
    setSaving(true);
    try {
      await fetch("/api/user-preferences/text-size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textSize: newSize }),
      });
    } catch {
      // localStorage already saved, server sync is best-effort
    }
    setSaving(false);
  }

  const options: { value: TextSize; label: string }[] = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];

  return (
    <div>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-alt p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleChange(opt.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              size === opt.value
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {saving && (
        <p className="text-xs text-muted mt-1">Saving...</p>
      )}
    </div>
  );
}

/**
 * Invisible initializer component — mount in layout to apply stored text size
 * on first render without layout shift.
 */
export function TextSizeInitializer() {
  useEffect(() => {
    const stored = getStoredTextSize();
    applyTextSize(stored);
  }, []);

  return null;
}
