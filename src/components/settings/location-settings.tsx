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
    return <div className="h-24 animate-pulse rounded-2xl bg-surface-alt" />;
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="eyebrow mb-1.5 block pl-4">Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g., Nashville, TN or 'The Shire'"
          className="field-glass w-full text-base"
          maxLength={100}
        />
      </div>

      <div>
        <p className="eyebrow mb-1.5 pl-4">Who can see it?</p>
        <div className="flex items-center gap-1 rounded-full border border-foreground/10 bg-surface/70 p-1 backdrop-blur-md">
          <button
            onClick={() => setVisibility("public")}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
              visibility === "public"
                ? "bg-accent text-black font-bold"
                : "text-muted hover:text-foreground"
            }`}
          >
            Everyone
          </button>
          <button
            onClick={() => setVisibility("followers")}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
              visibility === "followers"
                ? "bg-accent text-black font-bold"
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
        data-active="true"
        className="btn-glass px-5 py-2 text-sm disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Location"}
      </button>
    </div>
  );
}
