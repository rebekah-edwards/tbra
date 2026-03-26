"use client";

import { useState, useEffect } from "react";

interface LocationSettingsProps {
  userId: string;
}

export function LocationSettings({ userId }: LocationSettingsProps) {
  const [location, setLocation] = useState("");
  const [visibility, setVisibility] = useState<"public" | "followers">("public");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/user-preferences/location");
        if (res.ok) {
          const data = await res.json();
          setLocation(data.location || "");
          setVisibility(data.locationVisibility || "public");
        }
      } catch {
        // ignore
      }
      setLoaded(true);
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/user-preferences/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: location.trim(), locationVisibility: visibility }),
      });
    } catch {
      // ignore
    }
    setSaving(false);
  }

  if (!loaded) {
    return <div className="h-24 animate-pulse rounded-lg bg-surface-alt" />;
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm text-foreground block mb-1.5">Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g., Nashville, TN or 'The Shire'"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted outline-none focus:border-primary/50 transition-colors"
          maxLength={100}
        />
      </div>

      <div>
        <p className="text-sm text-foreground mb-1.5">Who can see your location?</p>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-alt p-1">
          <button
            onClick={() => setVisibility("public")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              visibility === "public"
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Everyone
          </button>
          <button
            onClick={() => setVisibility("followers")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              visibility === "followers"
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Followers only
          </button>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Location"}
      </button>
    </div>
  );
}
