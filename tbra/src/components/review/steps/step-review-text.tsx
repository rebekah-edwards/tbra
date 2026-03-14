"use client";

interface StepReviewTextProps {
  text: string | null;
  onChange: (text: string | null) => void;
}

export function StepReviewText({ text, onChange }: StepReviewTextProps) {
  return (
    <div className="flex flex-col gap-0 -mx-4 h-full px-4">
      <h2 className="font-heading text-2xl font-bold text-center pb-4">
        Write your review
      </h2>
      <p className="text-sm text-muted text-center pb-4">
        Share your thoughts about this book
      </p>
      <textarea
        value={text ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="What did you think? No spoilers, please..."
        className="flex-1 w-full rounded-xl border border-border bg-surface-alt p-4 text-sm text-foreground placeholder-muted resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary min-h-[200px]"
      />
    </div>
  );
}
