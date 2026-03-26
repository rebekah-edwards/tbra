"use client";

import { useState, useTransition } from "react";
import {
  type NotificationPrefs,
  updateNotificationPreferences,
} from "@/lib/actions/notification-preferences";

interface Props {
  initialPrefs: NotificationPrefs;
}

const TOGGLES: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  {
    key: "emailNewFollower",
    label: "New follower",
    description: "Email when someone follows you",
  },
  {
    key: "emailNewCorrection",
    label: "Correction responses",
    description: "Email when a correction you submitted gets a response",
  },
  {
    key: "emailWeeklyDigest",
    label: "Weekly reading digest",
    description: "A weekly summary of your reading activity",
  },
];

export function NotificationPreferences({ initialPrefs }: Props) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [isPending, startTransition] = useTransition();

  function toggle(key: keyof NotificationPrefs) {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    startTransition(async () => {
      const result = await updateNotificationPreferences({ [key]: next });
      if (!result.success) {
        // Revert on error
        setPrefs((p) => ({ ...p, [key]: !next }));
      }
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2
        className="section-heading text-lg mb-1"
      >
        Notifications
      </h2>
      <p className="text-xs text-muted mb-4">
        Choose which emails you receive
      </p>

      <div className="space-y-4">
        {TOGGLES.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted">{description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[key]}
              disabled={isPending}
              onClick={() => toggle(key)}
              className={`relative flex h-[26px] w-[46px] flex-shrink-0 items-center rounded-full border transition-colors duration-200 ${
                prefs[key]
                  ? "border-accent-dark bg-accent-dark"
                  : "border-border bg-surface-alt"
              } ${isPending ? "opacity-50" : ""}`}
            >
              <span
                className={`absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow-sm transition-all duration-200 ${
                  prefs[key] ? "left-[23px]" : "left-[2px]"
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
