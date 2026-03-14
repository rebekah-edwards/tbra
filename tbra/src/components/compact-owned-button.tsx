"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setOwnedFormats } from "@/lib/actions/reading-state";
import { FormatIcon } from "@/components/format-button";

const FORMATS = [
  { value: "hardcover", label: "Hardcover" },
  { value: "paperback", label: "Paperback" },
  { value: "ebook", label: "eBook" },
  { value: "audiobook", label: "Audiobook" },
] as const;

interface CompactOwnedButtonProps {
  bookId: string;
  currentFormats: string[];
  isLoggedIn: boolean;
  onFormatsChange?: (formats: string[]) => void;
}

export function CompactOwnedButton({
  bookId,
  currentFormats,
  isLoggedIn,
  onFormatsChange,
}: CompactOwnedButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [localFormats, setLocalFormats] = useState(currentFormats);
  const popoverRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    setLocalFormats(currentFormats);
  }, [currentFormats]);

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

  const isOwned = localFormats.length > 0;

  function handleToggleFormat(format: string) {
    const newFormats = localFormats.includes(format)
      ? localFormats.filter((f) => f !== format)
      : [...localFormats, format];

    setLocalFormats(newFormats);
    onFormatsChange?.(newFormats);
    startTransition(async () => {
      await setOwnedFormats(bookId, newFormats);
    });
  }

  return (
    <div className="relative inline-flex" ref={popoverRef}>
      <button
        onClick={() => {
          if (!isLoggedIn) {
            router.push("/login");
            return;
          }
          setOpen(!open);
        }}
        disabled={isPending}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
          isOwned
            ? "bg-neon-purple/15 text-neon-purple border border-neon-purple/30"
            : "bg-surface-alt text-muted border border-border hover:text-foreground hover:border-neon-purple/40"
        } ${isPending ? "opacity-60" : ""}`}
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
          <rect x="3" y="4" width="4" height="14" rx="0.5" fill={isOwned ? "none" : "currentColor"} stroke={isOwned ? "currentColor" : "none"} />
          <rect x="9" y="2" width="4" height="16" rx="0.5" fill={isOwned ? "none" : "currentColor"} stroke={isOwned ? "currentColor" : "none"} />
          <rect x="15" y="5" width="4" height="13" rx="0.5" fill={isOwned ? "none" : "currentColor"} stroke={isOwned ? "currentColor" : "none"} />
          <line x1="2" y1="20" x2="22" y2="20" />
        </svg>
        {isOwned ? `Owned` : "Owned"}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-40 rounded-lg border border-border bg-surface shadow-lg z-50 p-1.5">
          {FORMATS.map((f) => {
            const checked = localFormats.includes(f.value);
            return (
              <label
                key={f.value}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm cursor-pointer hover:bg-surface-alt transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleToggleFormat(f.value)}
                  className="accent-neon-purple h-3.5 w-3.5"
                />
                <FormatIcon format={f.value} />
                <span className={checked ? "text-foreground font-medium" : "text-muted"}>
                  {f.label}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
