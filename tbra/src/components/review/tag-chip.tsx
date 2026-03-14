"use client";

interface TagChipProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
}

export function TagChip({ label, selected, onToggle }: TagChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
        selected
          ? "bg-primary text-background font-medium"
          : "bg-surface-alt text-foreground/70 hover:bg-surface-alt/80"
      }`}
    >
      {label}
    </button>
  );
}
