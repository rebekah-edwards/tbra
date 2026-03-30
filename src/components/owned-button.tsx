"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setOwnedFormats } from "@/lib/actions/reading-state";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { EditionPicker } from "@/components/edition-picker";
import { FormatIcon } from "@/components/format-button";
import type { EditionSelection } from "@/app/book/[id]/book-page-client";

const STANDARD_FORMATS = [
  { value: "hardcover", label: "Hardcover" },
  { value: "paperback", label: "Paperback" },
  { value: "ebook", label: "eBook" },
  { value: "audiobook", label: "Audiobook" },
] as const;

const BOX_SET_FORMAT = { value: "set", label: "Box Set" } as const;

interface OwnedButtonProps {
  bookId: string;
  currentFormats: string[];
  isLoggedIn: boolean;
  isBoxSet?: boolean;
  openLibraryKey?: string | null;
  existingEditionSelections?: EditionSelection[];
  onEditionSelectionsChange?: (selections: EditionSelection[]) => void;
}

export function OwnedButton({
  bookId,
  currentFormats,
  isLoggedIn,
  isBoxSet = false,
  openLibraryKey,
  existingEditionSelections = [],
  onEditionSelectionsChange,
}: OwnedButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [localFormats, setLocalFormats] = useState(currentFormats);
  const [sheetFormat, setSheetFormat] = useState<string | null>(null);
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

  // Box sets show "Box Set" as the only format; regular books show the standard 4
  const FORMATS = isBoxSet ? [BOX_SET_FORMAT] : STANDARD_FORMATS;
  const isOwned = localFormats.length > 0;

  function handleToggleFormat(format: string) {
    const newFormats = localFormats.includes(format)
      ? localFormats.filter((f) => f !== format)
      : [...localFormats, format];

    setLocalFormats(newFormats);
    startTransition(async () => {
      await setOwnedFormats(bookId, newFormats);
    });
  }

  function handleSpecifyEditions(format: string) {
    setOpen(false);
    setSheetFormat(format);
  }

  const FORMAT_LABEL: Record<string, string> = {
    hardcover: "Hardcover",
    paperback: "Paperback",
    ebook: "eBook",
    audiobook: "Audiobook",
    set: "Box Set",
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => {
          if (!isLoggedIn) {
            router.push("/login");
            return;
          }
          setOpen(!open);
        }}
        disabled={isPending}
        className={`flex items-center gap-1.5 rounded-xl py-3 px-3 text-sm font-semibold transition-all w-full justify-center whitespace-nowrap ${
          isOwned
            ? "bg-neon-purple text-white shadow-[0_0_16px_rgba(192,132,252,0.3)] border-2 border-neon-purple"
            : "bg-neon-purple/10 text-muted border-2 border-neon-purple/40 hover:text-foreground hover:border-neon-purple/70"
        } ${isPending ? "opacity-60" : ""}`}
        title={isOwned ? `Owned: ${localFormats.join(", ")}` : "Mark as owned"}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0"
        >
          {/* Bookshelf: three books + shelf */}
          <rect x="3" y="4" width="4" height="14" rx="0.5" fill="none" />
          <rect x="9" y="2" width="4" height="16" rx="0.5" fill="none" />
          <rect x="15" y="5" width="4" height="13" rx="0.5" fill="none" />
          <line x1="2" y1="20" x2="22" y2="20" />
        </svg>
        {isOwned
          ? `Owned · ${localFormats.length}`
          : "Owned"}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 rounded-xl border border-border bg-surface shadow-xl z-50 p-2 popover-enter" style={{ width: "calc(200% + 0.75rem)" }}>
          <p className="px-3 pb-2 text-xs font-medium text-muted">Select formats you own</p>
          {FORMATS.map((f) => {
            const checked = localFormats.includes(f.value);
            return (
              <div key={f.value}>
                <label
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer hover:bg-surface-alt transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggleFormat(f.value)}
                    className="accent-neon-purple h-4 w-4"
                  />
                  <FormatIcon format={f.value} />
                  <span className={checked ? "text-foreground font-medium" : "text-muted"}>
                    {f.label}
                  </span>
                </label>
                {checked && openLibraryKey && (
                  <button
                    onClick={() => handleSpecifyEditions(f.value)}
                    className="flex items-center gap-1 px-3 py-1 mb-1 text-[11px] font-medium text-neon-purple hover:text-neon-purple/80 transition-colors"
                  >
                    <span>Specify edition</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openLibraryKey && sheetFormat && (
        <BottomSheet
          open={!!sheetFormat}
          onClose={() => setSheetFormat(null)}
          title={`${FORMAT_LABEL[sheetFormat] ?? sheetFormat} editions`}
        >
          <EditionPicker
            workKey={openLibraryKey}
            bookId={bookId}
            format={sheetFormat}
            existingSelections={existingEditionSelections}
            onSelectionsChange={onEditionSelectionsChange}
          />
        </BottomSheet>
      )}
    </div>
  );
}
