"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDisplayPrefs } from "@/lib/actions/display-prefs";

// Some readers find a goal or a streak takes away from reading. Each can be
// hidden on its own; hidden means hidden on Home and Stats (and in the app and
// its widget), and both keep counting so switching one back on shows the real
// number.

function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-foreground">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <span className="relative h-6 w-11 flex-shrink-0 rounded-full bg-border transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-neon-blue">
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
      </span>
    </label>
  );
}

export function GoalStreakSettings({ hideGoal, hideStreak }: { hideGoal: boolean; hideStreak: boolean }) {
  const [goalHidden, setGoalHidden] = useState(hideGoal);
  const [streakHidden, setStreakHidden] = useState(hideStreak);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function save(change: { hideGoal?: boolean; hideStreak?: boolean }, undo: () => void) {
    startTransition(async () => {
      const result = await updateDisplayPrefs(change);
      if (result.success) router.refresh();
      else undo();
    });
  }

  return (
    <div>
      <p className="text-sm text-foreground mb-1.5">Goal &amp; Streak</p>
      <p className="text-xs text-muted mb-2">
        Not everyone reads better with a target. Hide either one &mdash; it keeps counting, so you can bring it back any time.
      </p>
      <Switch
        label="Show reading goal"
        on={!goalHidden}
        disabled={isPending}
        onChange={(show) => {
          setGoalHidden(!show);
          save({ hideGoal: !show }, () => setGoalHidden(show));
        }}
      />
      <Switch
        label="Show reading streak"
        on={!streakHidden}
        disabled={isPending}
        onChange={(show) => {
          setStreakHidden(!show);
          save({ hideStreak: !show }, () => setStreakHidden(show));
        }}
      />
    </div>
  );
}
