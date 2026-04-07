"use client";

import { MOODS } from "@/lib/review-constants";

interface StepMoodProps {
  selected: string | null;
  onSelect: (key: string | null) => void;
}

export function StepMood({ selected, onSelect }: StepMoodProps) {
  return (
    <div className="flex flex-col items-center gap-4 -mt-4">
      <h2 className="font-heading text-xl font-bold text-center">
        How did this book make you feel?
      </h2>

      <div className="grid grid-cols-3 gap-2.5 w-full max-w-sm">
        {MOODS.map((mood) => {
          const isSelected = selected === mood.key;
          return (
            <button
              key={mood.key}
              type="button"
              onClick={() => onSelect(isSelected ? null : mood.key)}
              className={`flex flex-col items-center gap-0.5 rounded-2xl py-2.5 px-2 transition-all ${
                isSelected
                  ? "bg-accent/20 ring-2 ring-accent scale-105"
                  : "bg-surface-alt hover:bg-surface-alt/80"
              }`}
            >
              <span className="text-2xl">{mood.emoji}</span>
              <span className={`text-[11px] font-medium ${isSelected ? "text-accent" : "text-foreground/70"}`}>
                {mood.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
