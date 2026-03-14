"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { setActiveFormats } from "@/lib/actions/reading-state";

const FORMAT_LABELS: Record<string, string> = {
  hardcover: "Hardcover",
  paperback: "Paperback",
  ebook: "eBook",
  audiobook: "Audiobook",
};

const ALL_FORMATS = ["hardcover", "paperback", "ebook", "audiobook"];

export function FormatIcon({ format, size = 16 }: { format: string; size?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (format) {
    case "hardcover":
      return <svg {...props}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
    case "paperback":
      return <svg {...props}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>;
    case "ebook":
      return <svg {...props}><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="9" y1="18" x2="15" y2="18" /></svg>;
    case "audiobook":
      return <svg {...props}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg>;
    default:
      return null;
  }
}

interface FormatButtonProps {
  bookId: string;
  activeFormats: string[];
  isCurrentlyReading: boolean;
  isLoggedIn: boolean;
  forceOpen?: boolean;
  onForceOpenHandled?: () => void;
  onFormatsChange?: (formats: string[]) => void;
}

export function FormatButton({
  bookId,
  activeFormats,
  isCurrentlyReading,
  isLoggedIn,
  forceOpen,
  onForceOpenHandled,
  onFormatsChange,
}: FormatButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [localFormats, setLocalFormats] = useState(activeFormats);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalFormats(activeFormats);
  }, [activeFormats]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const disabled = !isLoggedIn || !isCurrentlyReading;
  const hasFormats = localFormats.length > 0;

  useEffect(() => {
    if (forceOpen && !disabled) {
      setOpen(true);
      onForceOpenHandled?.();
    }
  }, [forceOpen, disabled, onForceOpenHandled]);

  function handleToggleFormat(format: string) {
    const newFormats = localFormats.includes(format)
      ? localFormats.filter((f) => f !== format)
      : [...localFormats, format];

    setLocalFormats(newFormats);
    onFormatsChange?.(newFormats);
    startTransition(async () => {
      await setActiveFormats(bookId, newFormats);
    });
  }

  function formatSummary(): string {
    if (localFormats.length === 0) return "Format";
    if (localFormats.length === 1) return FORMAT_LABELS[localFormats[0]] ?? localFormats[0];
    return `${localFormats.length} formats`;
  }

  // Show the icon for the first selected format, or a generic book icon
  const leadIcon = localFormats.length === 1 ? localFormats[0] : "hardcover";

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
        disabled={disabled || isPending}
        className={`flex items-center gap-2 rounded-xl py-3 px-5 text-sm font-semibold transition-all w-full justify-center ${
          hasFormats
            ? "bg-neon-blue text-white shadow-[0_0_16px_rgba(96,165,250,0.3)]"
            : disabled
              ? "bg-surface-alt text-muted/50 border border-border cursor-not-allowed"
              : "bg-surface-alt text-muted border border-border hover:text-foreground hover:border-neon-blue/40"
        } ${isPending ? "opacity-60" : ""}`}
      >
        <FormatIcon format={leadIcon} size={18} />
        {formatSummary()}
      </button>

      {open && (
        <div className="absolute top-full right-0 left-0 mt-2 rounded-xl border border-border bg-surface shadow-xl z-50 p-2">
          <p className="px-3 pb-2 text-xs font-medium text-muted">Reading format(s)</p>
          {ALL_FORMATS.map((format) => {
            const checked = localFormats.includes(format);
            return (
              <label
                key={format}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer hover:bg-surface-alt transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleToggleFormat(format)}
                  className="accent-neon-blue h-4 w-4"
                />
                <FormatIcon format={format} />
                <span className={checked ? "text-foreground font-medium" : "text-muted"}>
                  {FORMAT_LABELS[format] ?? format}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
