"use client";

import type { ImportOptions } from "@/lib/import/import-options";

interface ImportOptionsUIProps {
  options: ImportOptions;
  onChange: (options: ImportOptions) => void;
}

export function ImportOptionsUI({ options, onChange }: ImportOptionsUIProps) {
  function toggle(key: keyof ImportOptions) {
    onChange({ ...options, [key]: !options[key] });
  }

  return (
    <div className="border border-border/50 bg-surface-alt/50 p-3 space-y-2.5">
      <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
        Update options for existing books
      </p>

      <label className="flex items-start gap-2.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={options.updateReadingStates}
          onChange={() => toggle("updateReadingStates")}
          className="mt-0.5 accent-accent"
        />
        <div>
          <p className="text-xs font-medium text-foreground group-hover:text-accent transition-colors">
            Update reading states
          </p>
          <p className="text-[11px] text-muted leading-snug">
            Only moves forward (e.g. TBR → finished), never backward
          </p>
        </div>
      </label>

      <label className="flex items-start gap-2.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={options.updateRatingsReviews}
          onChange={() => toggle("updateRatingsReviews")}
          className="mt-0.5 accent-accent"
        />
        <div>
          <p className="text-xs font-medium text-foreground group-hover:text-accent transition-colors">
            Update ratings &amp; reviews
          </p>
          <p className="text-[11px] text-muted leading-snug">
            Overwrite ratings, fill in missing reviews
          </p>
        </div>
      </label>

      <label className="flex items-start gap-2.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={options.updateOwnedFormats}
          onChange={() => toggle("updateOwnedFormats")}
          className="mt-0.5 accent-accent"
        />
        <div>
          <p className="text-xs font-medium text-foreground group-hover:text-accent transition-colors">
            Update owned library info
          </p>
          <p className="text-[11px] text-muted leading-snug">
            Merge formats, clean up unknown entries
          </p>
        </div>
      </label>

      <p className="text-[10px] text-muted/70 leading-snug">
        New books are always imported. These options only affect books already in your library.
      </p>
    </div>
  );
}
