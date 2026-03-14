"use client";

import { MOODS } from "@/lib/review-constants";

interface StepMoodProps {
  selected: string | null;
  onSelect: (key: string | null) => void;
}

export function StepMood({ selected, onSelect }: StepMoodProps) {
  return (
    <div className="flex flex-col items-center gap-8">
      <h2 className="font-heading text-2xl font-bold text-center">
        How did this book make you feel?
      </h2>

      <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
        {MOODS.map((mood) => {
          const isSelected = selected === mood.key;
          return (
            <button
              key={mood.key}
              type="button"
              onClick={() => onSelect(isSelected ? null : mood.key)}
              className={`flex flex-col items-center gap-1 rounded-2xl py-3 px-2 transition-all ${
                isSelected
                  ? "bg-primary/20 ring-2 ring-primary scale-105"
                  : "bg-surface-alt hover:bg-surface-alt/80"
              }`}
            >
              <span className="text-3xl">{mood.emoji}</span>
              <span className={`text-xs font-medium ${isSelected ? "text-primary" : "text-foreground/70"}`}>
                {mood.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
